/**
 * GameCore:一局游戏的宿主核心 —— 引擎 + AI 玩家 + 聊天 + 权限校验。
 * 单机模式直接使用;联机模式由房主端使用并把视图发布到 Firebase。
 */
import { GameEngine } from "../core/engine.js";
import { playerView, storytellerView } from "../core/view.js";
import { AIPlayer } from "../ai/aiController.js";
import { AIDriver } from "./aiDriver.js";
import { createRng, randomSeed } from "../core/rng.js";

export class GameCore {
  /**
   * @param players [{ id, name, isHuman, persona }] 按座位顺序
   * @param onUpdate 状态或聊天变化时回调
   */
  constructor(players, onUpdate, options = {}) {
    this.onUpdate = onUpdate;
    this.scriptId = options.scriptId || "trouble-brewing";
    this.storytellerId = options.storytellerId || null;
    this.chat = []; // { id, fromSeat, fromName, to, text, ts }
    this.chatSeq = 0;

    this.engine = GameEngine.create(players, {
      seed: options.seed,
      scriptId: this.scriptId,
      storytellerMode: this.storytellerId ? "human" : "auto"
    });
    this.rng = createRng(randomSeed());

    this.aiPlayers = new Map();
    for (const p of this.engine.state.players) {
      if (!p.isHuman) {
        this.aiPlayers.set(p.seat, new AIPlayer(p.seat, p.persona, this.rng));
      }
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

  /** 某座位可见的聊天:公开消息 + 与自己相关的私聊 */
  getChatForSeat(seat) {
    return this.chat.filter(
      (c) => c.to == null || c.to === seat || c.fromSeat === seat
    );
  }

  /* ---------------- 玩家动作(带权限校验) ---------------- */

  /**
   * 以某玩家身份分发动作。座位字段一律以调用者实际座位覆盖,防止伪造。
   * endDay 需要 isHost 权限(线上适配:房主代表全体宣布黄昏)。
   */
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
  /** 发送聊天(公开或私聊)。返回 {ok} */
  chatFrom(playerId, text, toSeat = null) {
    const seat = this.seatOf(playerId);
    if (seat < 0) return { ok: false, error: "你不在本局游戏中" };
    const trimmed = String(text || "").trim();
    if (!trimmed) return { ok: false, error: "消息为空" };
    if (this.engine.state.phase === "night") {
      return { ok: false, error: "夜晚请保持安静" };
    }
    this._pushChat(seat, trimmed.slice(0, 500), toSeat);

    // 触发 AI 反应
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

/** AI 玩家名字与性格池 */
export const AI_PERSONAS = [
  { name: "老周", persona: "大嗓门,喜欢带节奏,逢人就要身份" },
  { name: "小林", persona: "谨慎细心,喜欢分析票型和发言矛盾" },
  { name: "阿豪", persona: "冲动直接,怀疑谁就立刻提名" },
  { name: "梅姐", persona: "老练沉稳,后期才亮真实想法" },
  { name: "石头", persona: "话少,但每句都切中要害" },
  { name: "婉婉", persona: "善于共情,喜欢组建信任小圈子" },
  { name: "老赵", persona: "多疑,连自己队友都不太信" },
  { name: "丁丁", persona: "跳脱,偶尔口误暴露信息" },
  { name: "雪莉", persona: "逻辑派,喜欢列排除法" },
  { name: "大鹏", persona: "爱开玩笑,用玩笑试探别人" },
  { name: "青青", persona: "低调,倾向跟随大多数人投票" },
  { name: "老魏", persona: "喜欢私聊搞小动作,串联投票" },
  { name: "南南", persona: "首日激进,喜欢逼人对跳" },
  { name: "灰灰", persona: "存在感低,关键时刻突然发力" }
];
