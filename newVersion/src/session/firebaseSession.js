/**
 * 联机会话(Firebase Realtime Database)。
 *
 * 信任模型:房主端是权威 —— 引擎与 AI 只在房主浏览器运行(相当于自动说书人放在房主机器上)。
 * 玩家动作写入 actions 队列,房主消费后把各玩家"应见视图"写到 views/{uid},
 * 玩家永远拿不到别人的秘密信息。
 *
 * 对 UI 暴露的接口与 LocalSession 一致,另加大厅相关方法。
 */
import { GameCore, AI_PERSONAS } from "./gameCore.js";
import { ensureAuth, roomRef, fb, makeRoomCode } from "./firebase.js";
import { createRng, randomSeed } from "../core/rng.js";

const VIEW_CHAT_LIMIT = 200;

/** 房主与访客的公共部分:大厅状态订阅、聊天发送接口等 */
class BaseFirebaseSession {
  constructor(code, uid, name) {
    this.code = code;
    this.uid = uid;
    this.name = name;
    this.listeners = new Set();
    this.lobby = {}; // playerId -> {name, ai, persona, order}
    this.status = "lobby";
    this.view = null;
    this.chat = [];
    this._unsubs = [];
  }

  subscribe(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _notify() {
    for (const cb of this.listeners) cb();
  }

  _watch(reference, cb) {
    fb.onValue(reference, cb);
    this._unsubs.push(() => fb.off(reference, "value", cb));
  }

  _watchLobbyAndMeta() {
    this._watch(roomRef(this.code, "lobby"), (snap) => {
      this.lobby = snap.val() || {};
      this._notify();
    });
    this._watch(roomRef(this.code, "meta"), (snap) => {
      const meta = snap.val() || {};
      this.status = meta.status || "lobby";
      this._notify();
    });
  }

  getLobbyPlayers() {
    return Object.entries(this.lobby)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  getView() {
    return this.view;
  }

  getChat() {
    return this.chat;
  }

  leave() {
    for (const un of this._unsubs) un();
    this._unsubs = [];
    this.listeners.clear();
  }
}

/* ================= 房主 ================= */

export class FirebaseHostSession extends BaseFirebaseSession {
  static async create(playerName) {
    const uid = await ensureAuth();
    const code = makeRoomCode();
    const session = new FirebaseHostSession(code, uid, playerName);
    await fb.set(roomRef(code), {
      meta: { hostUid: uid, status: "lobby", createdAt: Date.now() },
      lobby: {
        [uid]: { name: playerName, ai: false, order: Date.now() }
      }
    });
    session._init();
    return session;
  }

  constructor(code, uid, name) {
    super(code, uid, name);
    this.isHost = true;
    this.mode = "multi-host";
    this.core = null;
    this.aiCounter = 0;
  }

  _init() {
    this._watchLobbyAndMeta();
    // 消费玩家动作队列
    const actionsRef = roomRef(this.code, "actions");
    const handler = (snap) => {
      const a = snap.val();
      fb.remove(snap.ref);
      if (a) this._handleRemoteAction(a);
    };
    fb.onChildAdded(actionsRef, handler);
    this._unsubs.push(() => fb.off(actionsRef, "child_added", handler));
  }

  /* ---------- 大厅操作 ---------- */

  async addAI() {
    const used = new Set(this.getLobbyPlayers().map((p) => p.name));
    const preset = AI_PERSONAS.find((p) => !used.has(p.name)) || {
      name: `AI-${++this.aiCounter}`, persona: "普通玩家"
    };
    const id = `ai-${Date.now()}-${this.aiCounter++}`;
    await fb.set(roomRef(this.code, "lobby", id), {
      name: preset.name, ai: true, persona: preset.persona, order: Date.now()
    });
  }

  async removePlayer(playerId) {
    if (playerId === this.uid) return;
    await fb.remove(roomRef(this.code, "lobby", playerId));
  }

  async startGame() {
    const entries = this.getLobbyPlayers();
    if (entries.length < 5 || entries.length > 15) {
      return { ok: false, error: "需要 5-15 名玩家" };
    }
    // 随机座位
    const rng = createRng(randomSeed());
    const players = rng.shuffle(entries).map((p) => ({
      id: p.id, name: p.name, isHuman: !p.ai, persona: p.persona || null
    }));

    this.core = new GameCore(players, () => this._publish());
    this.mySeat = this.core.seatOf(this.uid);
    await fb.update(roomRef(this.code, "meta"), { status: "playing" });
    this.core.start();
    return { ok: true };
  }

  /* ---------- 视图发布 ---------- */

  _publish() {
    if (!this.core) return;
    // 房主自己的视图直接取,免一次网络往返
    this.view = this.core.getViewFor(this.uid);
    this.chat = this.core.getChatForSeat(this.mySeat).slice(-VIEW_CHAT_LIMIT);
    this._notify();

    // 其他真人玩家:各自的视图 + 可见聊天
    const updates = {};
    for (const p of this.core.state.players) {
      if (!p.isHuman || p.id === this.uid) continue;
      updates[`views/${p.id}`] = {
        view: this.core.getViewFor(p.id),
        chat: this.core.getChatForSeat(p.seat).slice(-VIEW_CHAT_LIMIT),
        rev: Date.now()
      };
    }
    if (Object.keys(updates).length) {
      fb.update(roomRef(this.code), updates).catch((e) =>
        console.error("视图发布失败:", e)
      );
    }
  }

  /* ---------- 动作处理 ---------- */

  _handleRemoteAction(a) {
    if (!this.core || !a || !a.uid) return;
    if (a.kind === "chat") {
      this.core.chatFrom(a.uid, a.text, a.toSeat == null ? null : a.toSeat);
    } else if (a.kind === "action" && a.action) {
      this.core.dispatchFor(a.uid, a.action, { isHost: a.uid === this.uid });
    }
  }

  /* ---------- 房主本人动作(直达 core) ---------- */

  sendChat(text, toSeat = null) {
    return this.core.chatFrom(this.uid, text, toSeat);
  }
  nightAction(targets) {
    return this.core.dispatchFor(this.uid, { type: "nightAction", targets });
  }
  nominate(nominee) {
    return this.core.dispatchFor(this.uid, { type: "nominate", nominee });
  }
  vote(up) {
    return this.core.dispatchFor(this.uid, { type: "vote", up });
  }
  slayerShot(target) {
    return this.core.dispatchFor(this.uid, { type: "slayerShot", target });
  }
  endDay() {
    return this.core.dispatchFor(this.uid, { type: "endDay" }, { isHost: true });
  }

  leave() {
    if (this.core) this.core.dispose();
    fb.remove(roomRef(this.code)).catch(() => {});
    super.leave();
  }
}

/* ================= 访客 ================= */

export class FirebaseGuestSession extends BaseFirebaseSession {
  static async join(code, playerName) {
    const uid = await ensureAuth();
    const upper = code.toUpperCase().trim();
    const metaSnap = await fb.get(roomRef(upper, "meta"));
    if (!metaSnap.exists()) throw new Error("房间不存在");
    if ((metaSnap.val().status || "lobby") !== "lobby") throw new Error("游戏已开始,无法加入");

    await fb.set(roomRef(upper, "lobby", uid), {
      name: playerName, ai: false, order: Date.now()
    });
    const session = new FirebaseGuestSession(upper, uid, playerName);
    session._init();
    return session;
  }

  constructor(code, uid, name) {
    super(code, uid, name);
    this.isHost = false;
    this.mode = "multi-guest";
  }

  _init() {
    this._watchLobbyAndMeta();
    this._watch(roomRef(this.code, "views", this.uid), (snap) => {
      const data = snap.val();
      if (data) {
        this.view = data.view || null;
        this.chat = data.chat || [];
        this._notify();
      }
    });
  }

  _pushAction(payload) {
    fb.push(roomRef(this.code, "actions"), { uid: this.uid, ts: Date.now(), ...payload });
    return { ok: true, pending: true };
  }

  sendChat(text, toSeat = null) {
    return this._pushAction({ kind: "chat", text, toSeat: toSeat == null ? null : toSeat });
  }
  nightAction(targets) {
    return this._pushAction({ kind: "action", action: { type: "nightAction", targets } });
  }
  nominate(nominee) {
    return this._pushAction({ kind: "action", action: { type: "nominate", nominee } });
  }
  vote(up) {
    return this._pushAction({ kind: "action", action: { type: "vote", up } });
  }
  slayerShot(target) {
    return this._pushAction({ kind: "action", action: { type: "slayerShot", target } });
  }
  endDay() {
    return { ok: false, error: "只有房主可以宣布黄昏" };
  }

  leave() {
    fb.remove(roomRef(this.code, "lobby", this.uid)).catch(() => {});
    super.leave();
  }
}
