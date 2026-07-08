import { GameCore, AI_PERSONAS } from "./gameCore.js";
import { ensureAuth, getCurrentUser, roomRef, fb, makeRoomCode } from "./firebase.js";
import { createRng, randomSeed } from "../core/rng.js";
import { buildReplayFromCore } from "./gameHistory.js";
import { saveGameReplay } from "./profileStore.js";

const VIEW_CHAT_LIMIT = 200;
const RESUME_KEY = "botc.firebase.resume.v1";
const HOST_CORE_PREFIX = "botc.firebase.hostCore.";

function makeGameId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 当前登录用户在个人中心设置的头像(未设置时为空串) */
function myPhotoURL() {
  try {
    return getCurrentUser()?.photoURL || "";
  } catch {
    return "";
  }
}

function saveResume(data) {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch (error) {
    console.warn("保存联机房间恢复信息失败:", error);
  }
}

function readResume() {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearResume(code = null) {
  try {
    const current = readResume();
    if (!code || current?.code === code) localStorage.removeItem(RESUME_KEY);
  } catch {
    localStorage.removeItem(RESUME_KEY);
  }
}

function saveHostCore(code, gameId, core) {
  if (!core) return;
  try {
    localStorage.setItem(`${HOST_CORE_PREFIX}${code}`, JSON.stringify({
      gameId,
      core: core.serialize(),
      savedAt: Date.now()
    }));
  } catch (error) {
    console.warn("保存房主权限状态失败", error);
  }
}

function readHostCore(code) {
  try {
    const raw = localStorage.getItem(`${HOST_CORE_PREFIX}${code}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function stampView(view, code, gameId) {
  return view ? { ...view, roomCode: code, gameId } : null;
}

function isFreshPayload(data, code, gameId) {
  if (!data) return false;
  if (data.roomCode && data.roomCode !== code) return false;
  if (gameId && data.gameId !== gameId) return false;
  if (gameId && data.view?.gameId && data.view.gameId !== gameId) return false;
  return true;
}

class BaseFirebaseSession {
  constructor(code, uid, name) {
    this.code = code;
    this.uid = uid;
    this.name = name;
    this.listeners = new Set();
    this.lobby = {};
    this.status = "lobby";
    this.scriptId = "trouble-brewing";
    this.storytellerName = name;
    this.storytellerUid = uid;
    this.storytellerMode = "human";
    this.storytellerPhotoURL = "";
    this.gameId = null;
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

  _persistResume() {
    saveResume({
      code: this.code,
      uid: this.uid,
      name: this.name,
      mode: this.mode,
      isHost: this.isHost,
      status: this.status,
      scriptId: this.scriptId,
      storytellerMode: this.storytellerMode,
      gameId: this.gameId
    });
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
      const nextGameId = meta.gameId || null;
      const gameChanged = this.gameId && nextGameId && this.gameId !== nextGameId;
      this.status = meta.status || "lobby";
      this.scriptId = meta.scriptId || this.scriptId;
      this.storytellerName = meta.storytellerName || this.storytellerName;
      this.storytellerUid = meta.storytellerUid || this.storytellerUid;
      this.storytellerMode = meta.storytellerMode || this.storytellerMode;
      this.storytellerPhotoURL = meta.storytellerPhotoURL || "";
      this.gameId = nextGameId;
      this.startedAt = meta.startedAt || this.startedAt || null;
      if (gameChanged && !this.isHost) {
        this.view = null;
        this.chat = [];
      }
      this._persistResume();
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
    clearResume(this.code);
  }
}

export class FirebaseHostSession extends BaseFirebaseSession {
  static async create(playerName, scriptId = "trouble-brewing") {
    clearResume();
    const uid = await ensureAuth();
    const code = makeRoomCode();
    const session = new FirebaseHostSession(code, uid, playerName);
    await fb.set(roomRef(code), {
      meta: {
        hostUid: uid,
        storytellerUid: uid,
        storytellerName: playerName,
        storytellerMode: "human",
        storytellerPhotoURL: myPhotoURL(),
        scriptId,
        status: "lobby",
        gameId: null,
        createdAt: Date.now()
      },
      lobby: {},
      views: {}
    });
    session.scriptId = scriptId;
    session._persistResume();
    session._init();
    return session;
  }

  static async resumeSaved() {
    const saved = readResume();
    if (!saved?.code) return null;
    const uid = await ensureAuth();
    if (saved.uid && saved.uid !== uid) {
      clearResume(saved.code);
      return null;
    }
    const metaSnap = await fb.get(roomRef(saved.code, "meta"));
    if (!metaSnap.exists()) {
      clearResume(saved.code);
      return null;
    }
    const meta = metaSnap.val() || {};
    if (meta.hostUid !== uid) return FirebaseGuestSession.resumeSaved(saved, uid, meta);

    const session = new FirebaseHostSession(saved.code, uid, saved.name || meta.storytellerName || "说书人");
    session.status = meta.status || "lobby";
    session.scriptId = meta.scriptId || saved.scriptId || "trouble-brewing";
    session.storytellerName = meta.storytellerName || session.name;
    session.storytellerUid = meta.storytellerUid || uid;
    session.storytellerMode = meta.storytellerMode || "human";
    session.gameId = meta.gameId || saved.gameId || null;
    session.startedAt = meta.startedAt || saved.startedAt || null;

    const hostSnapshot = readHostCore(saved.code);
    const snapshotMatches = !session.gameId || hostSnapshot?.gameId === session.gameId;
    if (session.status === "playing" && snapshotMatches && hostSnapshot?.core?.engineState) {
      session.core = GameCore.hydrate(hostSnapshot.core, () => session._publish(), {
        storytellerId: uid
      });
      const isSt = session.storytellerMode === "human" && session.storytellerUid === uid;
      session.mySeat = isSt ? -1 : session.core.state.players.findIndex((p) => p.id === uid);
      session.view = stampView(
        isSt ? session.core.getStorytellerView() : session.core.getViewFor(uid),
        session.code, session.gameId
      );
      session.chat = session.core.getAllChat().slice(-VIEW_CHAT_LIMIT);
    }

    session._persistResume();
    session._init();
    if (session.core) setTimeout(() => session._publish(), 0);
    return session;
  }

  constructor(code, uid, name) {
    super(code, uid, name);
    this.isHost = true;
    this.mode = "multi-host";
    this.core = null;
    this.aiCounter = 0;
    this.mySeat = -1;
  }

  _init() {
    this._watchLobbyAndMeta();
    const actionsRef = roomRef(this.code, "actions");
    const handler = (snap) => {
      const a = snap.val();
      fb.remove(snap.ref);
      if (a) this._handleRemoteAction(a);
    };
    fb.onChildAdded(actionsRef, handler);
    this._unsubs.push(() => fb.off(actionsRef, "child_added", handler));
  }

  async addAI() {
    const used = new Set(this.getLobbyPlayers().map((p) => p.name));
    const preset = AI_PERSONAS.find((p) => !used.has(p.name)) || {
      name: `AI-${++this.aiCounter}`,
      persona: "普通玩家"
    };
    const id = `ai-${Date.now()}-${this.aiCounter++}`;
    await fb.set(roomRef(this.code, "lobby", id), {
      name: preset.name,
      ai: true,
      role: "ai",
      persona: preset.persona,
      order: Date.now()
    });
  }

  async removePlayer(playerId) {
    await fb.remove(roomRef(this.code, "lobby", playerId));
  }

  /** 房主将说书人职位转让给等待房间中的另一位玩家 */
  async setStoryteller(newUid, newName, newPhotoURL = "") {
    if (!this.isHost) return;
    const oldUid = this.storytellerUid || this.uid;
    const oldName = this.storytellerName;
    const oldPhotoURL = this.storytellerPhotoURL || "";
    const updates = {};

    updates["meta/storytellerUid"] = newUid;
    updates["meta/storytellerName"] = newName;
    updates["meta/storytellerMode"] = "human";
    updates["meta/storytellerPhotoURL"] = newUid === this.uid ? myPhotoURL() : (newPhotoURL || "");

    // 如果新说书人不是房主，将其从 lobby 中移除
    if (newUid !== this.uid) {
      updates["lobby/" + newUid] = null;
    }

    // 旧说书人如果不是房主，将其加回 lobby
    if (oldUid && oldUid !== this.uid) {
      updates["lobby/" + oldUid] = {
        name: oldName,
        ai: false,
        role: "player",
        photoURL: oldPhotoURL,
        order: Date.now()
      };
    }

    // 房主变成普通玩家时，加入 lobby
    if (newUid !== this.uid && !this.lobby[this.uid]) {
      updates["lobby/" + this.uid] = {
        name: this.name,
        ai: false,
        role: "player",
        photoURL: myPhotoURL(),
        order: Date.now() + 1
      };
    }

    // 房主重新成为说书人时，从 lobby 移除
    if (newUid === this.uid) {
      updates["lobby/" + this.uid] = null;
    }

    await fb.update(roomRef(this.code), updates);
  }

  /** 房主切换为 AI 说书人模式 */
  async setAIStoryteller() {
    if (!this.isHost) return;
    const oldUid = this.storytellerUid || this.uid;
    const oldName = this.storytellerName;
    const updates = {};

    updates["meta/storytellerUid"] = "";
    updates["meta/storytellerName"] = "AI说书人";
    updates["meta/storytellerMode"] = "ai";
    updates["meta/storytellerPhotoURL"] = "";

    // 旧说书人如果不是房主，将其加回 lobby
    if (oldUid && oldUid !== this.uid) {
      updates["lobby/" + oldUid] = {
        name: oldName,
        ai: false,
        role: "player",
        photoURL: this.storytellerPhotoURL || "",
        order: Date.now()
      };
    }

    // 房主加入 lobby 作为普通玩家
    if (!this.lobby[this.uid]) {
      updates["lobby/" + this.uid] = {
        name: this.name,
        ai: false,
        role: "player",
        photoURL: myPhotoURL(),
        order: Date.now() + 1
      };
    }

    await fb.update(roomRef(this.code), updates);
  }

  async startGame() {
    const entries = this.getLobbyPlayers();
    if (entries.length < 5 || entries.length > 15) {
      return { ok: false, error: "需要 5-15 名玩家" };
    }
    this.gameId = makeGameId();
    await fb.remove(roomRef(this.code, "views"));

    const rng = createRng(randomSeed());
    const players = rng.shuffle(entries).map((p) => ({
      id: p.id,
      name: p.name,
      isHuman: !p.ai,
      avatar: p.photoURL || null,
      persona: p.persona || null
    }));

    const mode = this.storytellerMode || "human";
    const storytellerIsHost = mode === "human" && this.storytellerUid === this.uid;

    if (storytellerIsHost) {
      // 模式一: 房主即说书人(当前默认行为)
      this.core = new GameCore(players, () => this._publish(), {
        scriptId: this.scriptId,
        storytellerId: this.uid
      });
      this.mySeat = -1;
    } else if (mode === "ai") {
      // 模式三: AI 说书人
      this.core = new GameCore(players, () => this._publish(), {
        scriptId: this.scriptId,
        aiStoryteller: true
      });
      this.mySeat = this.core.state.players.findIndex((p) => p.id === this.uid);
    } else {
      // 模式二: 委托说书人给其他玩家
      this.core = new GameCore(players, () => this._publish(), {
        scriptId: this.scriptId,
        storytellerId: this.storytellerUid
      });
      this.mySeat = this.core.state.players.findIndex((p) => p.id === this.uid);
    }

    await fb.update(roomRef(this.code, "meta"), { status: "playing", gameId: this.gameId, startedAt: this.startedAt });
    this._persistResume();
    this.core.start();
    return { ok: true };
  }

  _publish() {
    if (!this.core) return;
    saveHostCore(this.code, this.gameId, this.core);

    const storytellerIsHost = this.storytellerMode === "human" && this.storytellerUid === this.uid;
    const hasDelegatedSt = this.storytellerMode === "human" && this.storytellerUid && this.storytellerUid !== this.uid;

    if (storytellerIsHost) {
      // 房主即说书人：本地使用 storytellerView
      this.view = stampView(this.core.getStorytellerView(), this.code, this.gameId);
    } else {
      // 房主是普通玩家：本地使用玩家视角
      this.view = stampView(this.core.getViewFor(this.uid), this.code, this.gameId);
    }
    this.chat = this.core.getAllChat().slice(-VIEW_CHAT_LIMIT);
    this._persistResume();
    this._notify();
    this._saveReplayIfEnded();

    const updates = {};
    updates["views/_spectator"] = {
      roomCode: this.code,
      gameId: this.gameId,
      view: stampView(this.core.getSpectatorView(), this.code, this.gameId),
      chat: this.core.getPublicChat().slice(-VIEW_CHAT_LIMIT),
      rev: Date.now()
    };

    // 委托说书人模式：发布 storytellerView 到远程说书人
    if (hasDelegatedSt) {
      updates[`views/${this.storytellerUid}`] = {
        roomCode: this.code,
        gameId: this.gameId,
        view: stampView(this.core.getStorytellerView(), this.code, this.gameId),
        chat: this.core.getAllChat().slice(-VIEW_CHAT_LIMIT),
        rev: Date.now()
      };
    }

    for (const p of this.core.state.players) {
      if (!p.isHuman || p.id === this.uid) continue;
      // 委托说书人不发布玩家视图（他们已收到 storytellerView）
      if (hasDelegatedSt && p.id === this.storytellerUid) continue;
      const view = stampView(this.core.getViewFor(p.id), this.code, this.gameId);
      updates[`views/${p.id}`] = {
        roomCode: this.code,
        gameId: this.gameId,
        view,
        chat: this.core.getChatForSeat(p.seat).slice(-VIEW_CHAT_LIMIT),
        rev: Date.now()
      };
    }
    if (Object.keys(updates).length) {
      fb.update(roomRef(this.code), updates).catch((e) => console.error("视图发布失败:", e));
    }
  }

  _saveReplayIfEnded() {
    if (!this.core || this.core.state.phase !== "end" || !this.gameId) return;
    if (this._savedReplayGameId === this.gameId) return;
    const replay = buildReplayFromCore(this.core, {
      gameId: this.gameId,
      createdBy: this.uid,
      mode: "multi",
      roomCode: this.code,
      startedAt: this.startedAt,
      endedAt: Date.now()
    });
    if (!replay) return;
    this._savedReplayGameId = this.gameId;
    saveGameReplay(replay).catch((error) => {
      this._savedReplayGameId = null;
      console.error("保存对局复盘失败:", error);
    });
  }

  _handleRemoteAction(a) {
    if (!this.core || !a || !a.uid) return;
    if (this.gameId && a.gameId && a.gameId !== this.gameId) return;
    if (a.kind === "chat") {
      this.core.chatFrom(a.uid, a.text, a.toSeat == null ? null : a.toSeat);
    } else if (a.kind === "action" && a.action) {
      this.core.dispatchFor(a.uid, a.action, { isHost: a.uid === this.uid });
    } else if (a.kind === "storytellerAction" && a.action) {
      // 远程委托说书人发来的说书人操作
      this.core.dispatchStoryteller(a.action);
    }
  }

  sendChat(text, toSeat = null) {
    if (this.mySeat === -1) return { ok: false, error: "说书人暂不参与玩家聊天" };
    if (!this.core) return { ok: false, error: "游戏尚未开始" };
    return this.core.chatFrom(this.uid, text, toSeat);
  }
  nightAction(targets) {
    if (this.mySeat === -1) return { ok: false, error: "说书人不能执行玩家夜间行动" };
    if (!this.core) return { ok: false, error: "游戏尚未开始" };
    return this.core.dispatchFor(this.uid, { type: "nightAction", targets });
  }
  nominate(nominee) {
    if (this.mySeat === -1) return { ok: false, error: "说书人不能提名" };
    if (!this.core) return { ok: false, error: "游戏尚未开始" };
    return this.core.dispatchFor(this.uid, { type: "nominate", nominee });
  }
  vote(up) {
    if (this.mySeat === -1) return { ok: false, error: "说书人不能投票" };
    if (!this.core) return { ok: false, error: "游戏尚未开始" };
    return this.core.dispatchFor(this.uid, { type: "vote", up: !!up });
  }
  slayerShot(target) {
    if (this.mySeat === -1) return { ok: false, error: "说书人不能使用玩家能力" };
    if (!this.core) return { ok: false, error: "游戏尚未开始" };
    return this.core.dispatchFor(this.uid, { type: "slayerShot", target });
  }
  endDay() {
    return this.core ? this.core.dispatchStoryteller({ type: "endDay" }) : { ok: false, error: "游戏尚未开始" };
  }
  storytellerAction(action) {
    return this.core ? this.core.dispatchStoryteller(action) : { ok: false, error: "游戏尚未开始" };
  }

  /** AI 建议人类为当前待裁定事项给出建议,不执行 */
  suggestDecision() {
    return this.core ? this.core.suggestDecision() : Promise.resolve(null);
  }

  /** 切换 AI 说书人托管(自动应答所有待托管项目) */
  setStorytellerAutopilot(enabled) {
    return this.core ? this.core.setStorytellerAutopilot(enabled) : false;
  }

  get storytellerAutopilot() {
    return this.core ? this.core.stAutopilot : false;
  }

  leave() {
    if (this.core) this.core.dispose();
    fb.remove(roomRef(this.code)).catch(() => {});
    try { localStorage.removeItem(`${HOST_CORE_PREFIX}${this.code}`); } catch {}
    super.leave();
  }
}

export class FirebaseGuestSession extends BaseFirebaseSession {
  static async join(code, playerName) {
    clearResume();
    const uid = await ensureAuth();
    const upper = code.toUpperCase().trim();
    const metaSnap = await fb.get(roomRef(upper, "meta"));
    if (!metaSnap.exists()) throw new Error("房间不存在");
    const meta = metaSnap.val() || {};
    if ((meta.status || "lobby") !== "lobby") {
      const session = new FirebaseGuestSession(upper, uid, playerName, { spectator: true });
      session.status = meta.status || "playing";
      session.scriptId = meta.scriptId || session.scriptId;
      session.storytellerName = meta.storytellerName || session.storytellerName;
      session.storytellerUid = meta.storytellerUid || "";
      session.storytellerMode = meta.storytellerMode || "human";
      session.gameId = meta.gameId || null;
      session._persistResume();
      session._init();
      return session;
    }

    await fb.remove(roomRef(upper, "views", uid));
    await fb.set(roomRef(upper, "lobby", uid), {
      name: playerName,
      ai: false,
      role: "player",
      photoURL: myPhotoURL(),
      order: Date.now()
    });
    const session = new FirebaseGuestSession(upper, uid, playerName);
    session.scriptId = meta.scriptId || session.scriptId;
    session.storytellerName = meta.storytellerName || session.storytellerName;
    session.storytellerUid = meta.storytellerUid || "";
    session.storytellerMode = meta.storytellerMode || "human";
    session.gameId = meta.gameId || null;
    session._persistResume();
    session._init();
    return session;
  }

  static async resumeSaved(saved = readResume(), uid = null, meta = null) {
    if (!saved?.code) return null;
    const finalUid = uid || await ensureAuth();
    if (saved.uid && saved.uid !== finalUid) {
      clearResume(saved.code);
      return null;
    }
    let finalMeta = meta;
    if (!finalMeta) {
      const metaSnap = await fb.get(roomRef(saved.code, "meta"));
      if (!metaSnap.exists()) {
        clearResume(saved.code);
        return null;
      }
      finalMeta = metaSnap.val() || {};
    }
    const session = new FirebaseGuestSession(saved.code, finalUid, saved.name || "鐜╁", {
      spectator: saved.mode === "multi-spectator"
    });
    session.status = finalMeta.status || "lobby";
    session.scriptId = finalMeta.scriptId || saved.scriptId || "trouble-brewing";
    session.storytellerName = finalMeta.storytellerName || "说书人";
    session.storytellerUid = finalMeta.storytellerUid || "";
    session.storytellerMode = finalMeta.storytellerMode || "human";
    session.gameId = finalMeta.gameId || saved.gameId || null;
    session.startedAt = finalMeta.startedAt || saved.startedAt || null;
    session._persistResume();
    session._init();
    return session;
  }

  constructor(code, uid, name, options = {}) {
    super(code, uid, name);
    this.isHost = false;
    this.isSpectator = !!options.spectator;
    this.mode = this.isSpectator ? "multi-spectator" : "multi-guest";
  }

  _init() {
    this._watchLobbyAndMeta();
    this._watch(roomRef(this.code, "views", this.isSpectator ? "_spectator" : this.uid), (snap) => {
      const data = snap.val();
      if (!data) return;
      if (!isFreshPayload(data, this.code, this.gameId)) {
        this.view = null;
        this.chat = [];
        this._notify();
        return;
      }
      this.view = stampView(data.view || null, this.code, this.gameId || data.gameId || null);
      this.chat = Array.isArray(data.chat) ? data.chat : [];
      this._notify();
    });
  }

  _pushAction(payload) {
    fb.push(roomRef(this.code, "actions"), { uid: this.uid, ts: Date.now(), gameId: this.gameId, ...payload });
    return { ok: true, pending: true };
  }

  sendChat(text, toSeat = null) {
    if (this.isSpectator) return { ok: false, error: "观众不能参与发言" };
    return this._pushAction({ kind: "chat", text, toSeat: toSeat == null ? null : toSeat });
  }
  nightAction(targets) {
    if (this.isSpectator) return { ok: false, error: "观众不能行动" };
    return this._pushAction({ kind: "action", action: { type: "nightAction", targets } });
  }
  nominate(nominee) {
    if (this.isSpectator) return { ok: false, error: "观众不能提名" };
    return this._pushAction({ kind: "action", action: { type: "nominate", nominee } });
  }
  vote(up) {
    if (this.isSpectator) return { ok: false, error: "观众不能投票" };
    return this._pushAction({ kind: "action", action: { type: "vote", up } });
  }
  slayerShot(target) {
    if (this.isSpectator) return { ok: false, error: "观众不能使用玩家能力" };
    return this._pushAction({ kind: "action", action: { type: "slayerShot", target } });
  }
  endDay() {
    return this._pushAction({ kind: "storytellerAction", action: { type: "endDay" } });
  }

  storytellerAction(action) {
    return this._pushAction({ kind: "storytellerAction", action });
  }

  leave() {
    if (!this.isSpectator) fb.remove(roomRef(this.code, "lobby", this.uid)).catch(() => {});
    super.leave();
  }
}





