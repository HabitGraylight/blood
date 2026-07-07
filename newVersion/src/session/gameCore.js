/**
 * GameCore: one authoritative game instance.
 * It wraps the engine, AI driver and chat log, and can be serialized so refresh
 * does not throw the player back to the home screen.
 */
import { GameEngine } from "../core/engine.js";
import { playerView, storytellerView } from "../core/view.js";
import { AIPlayer } from "../ai/aiController.js";
import { AIDriver } from "./aiDriver.js";
import { createRng, randomSeed } from "../core/rng.js";

export class GameCore {
  constructor(players, onUpdate, options = {}) {
    this.onUpdate = onUpdate;
    this.storytellerId = options.storytellerId || options.snapshot?.storytellerId || null;
    this.chat = options.snapshot?.chat ? [...options.snapshot.chat] : [];
    this.chatSeq = options.snapshot?.chatSeq || this.chat.reduce((max, c) => Math.max(max, c.id || 0), 0);

    if (options.snapshot?.engineState) {
      this.engine = GameEngine.hydrate(options.snapshot.engineState);
      this.scriptId = this.engine.state.scriptId || options.scriptId || "trouble-brewing";
    } else {
      this.scriptId = options.scriptId || "trouble-brewing";
      this.engine = GameEngine.create(players, {
        seed: options.seed,
        scriptId: this.scriptId,
        storytellerMode: this.storytellerId ? "human" : "auto"
      });
    }

    this.rng = createRng(options.aiSeed != null ? options.aiSeed : randomSeed());
    this._mountAI();
  }

  static hydrate(snapshot, onUpdate, options = {}) {
    return new GameCore([], onUpdate, { ...options, snapshot });
  }

  serialize() {
    return {
      scriptId: this.scriptId,
      storytellerId: this.storytellerId,
      engineState: this.engine.serialize(),
      chat: this.chat.slice(-500),
      chatSeq: this.chatSeq
    };
  }

  _mountAI() {
    this.aiPlayers = new Map();
    for (const p of this.engine.state.players) {
      if (!p.isHuman) this.aiPlayers.set(p.seat, new AIPlayer(p.seat, p.persona, this.rng));
    }

    this.driver = new AIDriver({
      engine: this.engine,
      aiPlayers: this.aiPlayers,
      rng: this.rng,
      getChatFor: (seat) => this.getChatForSeat(seat),
      pushChat: (fromSeat, text, toSeat) => this._pushChat(fromSeat, text, toSeat),
      onChange: () => this.onUpdate()
    });
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
    if (seat < 0) return null;
    return playerView(this.engine.state, seat);
  }

  getStorytellerView() {
    return storytellerView(this.engine.state);
  }

  getAllChat() {
    return this.chat;
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
      this.onUpdate();
      this.driver.tick();
    }
    return res;
  }

  dispatchStoryteller(action) {
    const allowed = new Set([
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

    this._pushChat(seat, trimmed.slice(0, 500), toSeat);
    if (toSeat == null) {
      this.driver.onHumanChat(seat, trimmed);
    } else if (this.aiPlayers.has(toSeat)) {
      this.driver.onWhisper(seat, toSeat, trimmed);
    }
    return { ok: true };
  }

  _pushChat(fromSeat, text, toSeat) {
    const from = this.engine.state.players[fromSeat];
    this.chat.push({
      id: ++this.chatSeq,
      fromSeat,
      fromName: from ? from.name : "?",
      to: toSeat == null ? null : toSeat,
      text,
      ts: Date.now()
    });
    if (this.chat.length > 500) this.chat.splice(0, this.chat.length - 500);
    this.onUpdate();
  }
}

export const AI_PERSONAS = [
  { name: "老周", persona: "大嗓门,喜欢带节奏,逢人就要身份" },
  { name: "小林", persona: "谨慎细心,喜欢分析票型和发言矛盾" },
  { name: "阿豹", persona: "冲动直接,怀疑谁就立刻提名" },
  { name: "梅姨", persona: "老练沉稳,后期才亮真实想法" },
  { name: "石头", persona: "话少,但每句都切中要害" },
  { name: "婉婷", persona: "善于共情,喜欢组建信任小圈子" },
  { name: "老赵", persona: "多疑,连自己队友都不太信" },
  { name: "丁丁", persona: "跳脱,偶尔口误暴露信息" },
  { name: "雪莉", persona: "逻辑派,喜欢列排除法" },
  { name: "大鹏", persona: "爱开玩笑,用玩笑试探别人" },
  { name: "青青", persona: "低调,倾向跟随大多数人投票" },
  { name: "老鬼", persona: "喜欢私聊搞小动作,串联投票" },
  { name: "南南", persona: "首日激进,喜欢逼人对跳" },
  { name: "灰灰", persona: "存在感低,关键时刻突然发力" }
];
