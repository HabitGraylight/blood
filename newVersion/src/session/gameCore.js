/**
 * GameCore: one authoritative game instance.
 * It wraps the engine, AI driver and chat log, and can be serialized so refresh
 * does not throw the player back to the home screen.
 */
import { GameEngine } from "../core/engine.js";
import { playerView, storytellerView, spectatorView } from "../core/view.js";
import { AIPlayer } from "../ai/aiController.js";
import { AIStoryteller } from "../ai/storytellerController.js";
import { AIDriver } from "./aiDriver.js";
import { createRng, randomSeed } from "../core/rng.js";
import { resetLLMBudget } from "../ai/llm.js";

export class GameCore {
  constructor(players, onUpdate, options = {}) {
    this.onUpdate = onUpdate;
    this.storytellerId = options.storytellerId || options.snapshot?.storytellerId || null;
    this.chat = options.snapshot?.chat ? [...options.snapshot.chat] : [];
    this.chatSeq = options.snapshot?.chatSeq || this.chat.reduce((max, c) => Math.max(max, c.id || 0), 0);
    // 人类说书人可开启"AI 托管裁定"(运行时开关,不入存档)
    this.stAutopilot = false;
    // 存档恢复时还原各 AI 的长期记忆
    this._savedMemos = options.snapshot?.aiMemos || null;

    // 每局独立的 LLM 调用预算
    resetLLMBudget();

    if (options.snapshot?.engineState) {
      this.engine = GameEngine.hydrate(options.snapshot.engineState);
      this.scriptId = this.engine.state.scriptId || options.scriptId || "trouble-brewing";
    } else {
      this.scriptId = options.scriptId || "trouble-brewing";
      // aiStoryteller:无人类说书人时由 AI 行使完整裁量权(裁定、节奏、旁白)
      const storytellerMode = this.storytellerId
        ? "human"
        : options.aiStoryteller ? "ai" : "auto";
      this.engine = GameEngine.create(players, {
        seed: options.seed,
        scriptId: this.scriptId,
        storytellerMode
      });
    }

    this.rng = createRng(options.aiSeed != null ? options.aiSeed : randomSeed());
    this._mountAI();
  }

  static hydrate(snapshot, onUpdate, options = {}) {
    return new GameCore([], onUpdate, { ...options, snapshot });
  }

  serialize() {
    const aiMemos = {};
    for (const [seat, ai] of this.aiPlayers) {
      if (ai.memo) aiMemos[seat] = ai.memo;
    }
    return {
      scriptId: this.scriptId,
      storytellerId: this.storytellerId,
      engineState: this.engine.serialize(),
      chat: this.chat.slice(-500),
      chatSeq: this.chatSeq,
      aiMemos
    };
  }

  _mountAI() {
    this.aiPlayers = new Map();
    for (const p of this.engine.state.players) {
      if (!p.isHuman) {
        this.aiPlayers.set(p.seat, new AIPlayer(p.seat, p.persona, this.rng, {
          traits: traitsForPersona(p.persona),
          memo: this._savedMemos ? this._savedMemos[p.seat] || null : null
        }));
      }
    }

    // AI 说书人实例:"ai" 模式下驱动全局;"human" 模式下供托管/建议使用
    this.storytellerAI = new AIStoryteller(this.rng);

    this.driver = new AIDriver({
      engine: this.engine,
      aiPlayers: this.aiPlayers,
      rng: this.rng,
      getChatFor: (seat) => this.getChatForSeat(seat),
      pushChat: (fromSeat, text, toSeat) => this._pushChat(fromSeat, text, toSeat),
      onChange: () => this.onUpdate(),
      getStoryteller: () => {
        const mode = this.engine.state.storytellerMode;
        if (mode === "ai") return this.storytellerAI;
        if (mode === "human" && this.stAutopilot) return this.storytellerAI;
        return null;
      },
      getStorytellerView: () => storytellerView(this.engine.state)
    });
  }

  /** 人类说书人切换 AI 托管裁定 */
  setStorytellerAutopilot(enabled) {
    this.stAutopilot = !!enabled;
    if (enabled) this.driver.tick();
    return this.stAutopilot;
  }

  /** 让 AI 说书人为当前待裁定事项给出建议(不执行) */
  async suggestDecision() {
    const d = this.engine.state.pendingStorytellerDecision;
    if (!d) return null;
    return this.storytellerAI.decide(storytellerView(this.engine.state), d);
  }

  start() {
    this.onUpdate();
    this.driver.tick();
  }

  dispose() {
    this.driver.dispose();
  }

  get state() {
    return this.engine.state;
  }

  seatOf(playerId) {
    const p = this.engine.state.players.find((x) => x.id === playerId);
    return p ? p.seat : -1;
  }

  getViewFor(playerId) {
    if (playerId === this.storytellerId) return this.getStorytellerView();
    const seat = this.seatOf(playerId);
    if (seat < 0) return this.getSpectatorView();
    return playerView(this.engine.state, seat);
  }

  getStorytellerView() {
    return storytellerView(this.engine.state);
  }

  getSpectatorView() {
    return spectatorView(this.engine.state);
  }

  getAllChat() {
    return this.chat;
  }

  getPublicChat() {
    return this.chat.filter((c) => c.to == null);
  }

  getChatForSeat(seat) {
    return this.chat.filter((c) => c.to == null || c.to === seat || c.fromSeat === seat);
  }

  dispatchFor(playerId, action, { isHost = false } = {}) {
    const seat = this.seatOf(playerId);
    if (seat < 0) return { ok: false, error: "你不在本局游戏中" };

    let safe;
    switch (action.type) {
      case "nightAction":
        safe = { type: "nightAction", seat, targets: action.targets };
        break;
      case "nominate":
        safe = { type: "nominate", nominator: seat, nominee: action.nominee };
        break;
      case "vote":
        safe = { type: "vote", seat, up: !!action.up };
        break;
      case "slayerShot":
        safe = { type: "slayerShot", seat, target: action.target };
        break;
      case "endDay":
        if (!isHost) return { ok: false, error: "只有房主可以宣布黄昏" };
        safe = { type: "endDay" };
        break;
      default:
        return { ok: false, error: `未知动作: ${action.type}` };
    }

    const res = this.engine.dispatch(safe);
    if (res.ok) {
      this.driver.noteActivity(); // 真人操作(提名/投票等)会延缓说书人推进阶段
      this.onUpdate();
      this.driver.tick();
    }
    return res;
  }

  dispatchStoryteller(action) {
    const allowed = new Set([
      "storytellerDecide",
      "storytellerNarrate",
      "storytellerSetInfoOverride",
      "storytellerSetRegistration",
      "storytellerSetNightDeath",
      "storytellerResolveMayor",
      "storytellerAdvancePhase",
      "endDay"
    ]);
    if (!allowed.has(action.type)) return { ok: false, error: "该动作不是说书人动作" };
    const safe = action.type === "endDay" ? { type: "endDay" } : { ...action };
    const res = this.engine.dispatch(safe);
    if (res.ok) {
      this.onUpdate();
      this.driver.tick();
    }
    return res;
  }

  chatFrom(playerId, text, toSeat = null) {
    const seat = this.seatOf(playerId);
    if (seat < 0) return { ok: false, error: "你不在本局游戏中" };
    const trimmed = String(text || "").trim();
    if (!trimmed) return { ok: false, error: "消息为空" };
    if (this.engine.state.phase === "night") return { ok: false, error: "夜晚请保持安静" };

    this.driver.noteActivity(); // 真人发言会延缓说书人推进阶段
    const chatId = this._pushChat(seat, trimmed.slice(0, 500), toSeat);
    if (toSeat == null) {
      this.driver.onHumanChat(seat, trimmed, chatId);
    } else if (this.aiPlayers.has(toSeat)) {
      this.driver.onWhisper(seat, toSeat, trimmed, chatId);
    }
    return { ok: true };
  }

  _pushChat(fromSeat, text, toSeat) {
    const from = this.engine.state.players[fromSeat];
    const id = ++this.chatSeq;
    this.chat.push({
      id,
      fromSeat,
      fromName: from ? from.name : "?",
      to: toSeat == null ? null : toSeat,
      text,
      ts: Date.now()
    });
    if (this.chat.length > 500) this.chat.splice(0, this.chat.length - 500);
    this.onUpdate();
    return id;
  }
}

export const AI_PERSONAS = [
  { name: "老周", persona: "大嗓门,喜欢带节奏,逢人就要身份", traits: { aggr: 0.85, talk: 0.9 } },
  { name: "小林", persona: "谨慎细心,喜欢分析票型和发言矛盾", traits: { aggr: 0.35, talk: 0.6 } },
  { name: "阿豹", persona: "冲动直接,怀疑谁就立刻提名", traits: { aggr: 0.95, talk: 0.7 } },
  { name: "梅姨", persona: "老练沉稳,后期才亮真实想法", traits: { aggr: 0.3, talk: 0.4 } },
  { name: "石头", persona: "话少,但每句都切中要害", traits: { aggr: 0.5, talk: 0.2 } },
  { name: "婉婷", persona: "善于共情,喜欢组建信任小圈子", traits: { aggr: 0.4, talk: 0.75 } },
  { name: "老赵", persona: "多疑,连自己队友都不太信", traits: { aggr: 0.7, talk: 0.55 } },
  { name: "丁丁", persona: "跳脱,偶尔口误暴露信息", traits: { aggr: 0.6, talk: 0.85 } },
  { name: "雪莉", persona: "逻辑派,喜欢列排除法", traits: { aggr: 0.45, talk: 0.65 } },
  { name: "大鹏", persona: "爱开玩笑,用玩笑试探别人", traits: { aggr: 0.55, talk: 0.9 } },
  { name: "青青", persona: "低调,倾向跟随大多数人投票", traits: { aggr: 0.2, talk: 0.35 } },
  { name: "老鬼", persona: "喜欢私聊搞小动作,串联投票", traits: { aggr: 0.65, talk: 0.5 } },
  { name: "南南", persona: "首日激进,喜欢逼人对跳", traits: { aggr: 0.9, talk: 0.8 } },
  { name: "灰灰", persona: "存在感低,关键时刻突然发力", traits: { aggr: 0.4, talk: 0.25 } }
];

function traitsForPersona(persona) {
  const preset = AI_PERSONAS.find((p) => p.persona === persona);
  return preset ? preset.traits : null;
}
