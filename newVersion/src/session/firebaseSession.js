import { GameCore, AI_PERSONAS } from "./gameCore.js";
import { ensureAuth, roomRef, fb, makeRoomCode } from "./firebase.js";
import { createRng, randomSeed } from "../core/rng.js";

const VIEW_CHAT_LIMIT = 200;
const RESUME_KEY = "botc.firebase.resume.v1";
const HOST_CORE_PREFIX = "botc.firebase.hostCore.";

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

function saveHostCore(code, core) {
  if (!core) return;
  try {
    localStorage.setItem(`${HOST_CORE_PREFIX}${code}`, JSON.stringify({ core: core.serialize(), savedAt: Date.now() }));
  } catch (error) {
    console.warn("保存房主权威状态失败:", error);
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
      scriptId: this.scriptId
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
      this.status = meta.status || "lobby";
      this.scriptId = meta.scriptId || this.scriptId;
      this.storytellerName = meta.storytellerName || this.storytellerName;
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
    const uid = await ensureAuth();
    const code = makeRoomCode();
    const session = new FirebaseHostSession(code, uid, playerName);
    await fb.set(roomRef(code), {
      meta: {
        hostUid: uid,
        storytellerUid: uid,
        storytellerName: playerName,
        scriptId,
        status: "lobby",
        createdAt: Date.now()
      },
      lobby: {}
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
    const metaSnap = await fb.get(roomRef(saved.code, "meta"));
    if (!metaSnap.exists()) {
      clearResume(saved.code);
      return null;
    }
    const meta = metaSnap.val() || {};
    if (meta.storytellerUid !== uid) return FirebaseGuestSession.resumeSaved(saved, uid, meta);

    const session = new FirebaseHostSession(saved.code, uid, saved.name || meta.storytellerName || "说书人");
    session.status = meta.status || "lobby";
    session.scriptId = meta.scriptId || saved.scriptId || "trouble-brewing";
    session.storytellerName = meta.storytellerName || session.name;

    const hostSnapshot = readHostCore(saved.code);
    if (session.status === "playing" && hostSnapshot?.core?.engineState) {
      session.core = GameCore.hydrate(hostSnapshot.core, () => session._publish(), {
        storytellerId: uid
      });
      session.mySeat = -1;
      session.view = session.core.getStorytellerView();
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

  async startGame() {
    const entries = this.getLobbyPlayers();
    if (entries.length < 5 || entries.length > 15) {
      return { ok: false, error: "需要 5-15 名玩家" };
    }
    const rng = createRng(randomSeed());
    const players = rng.shuffle(entries).map((p) => ({
      id: p.id,
      name: p.name,
      isHuman: !p.ai,
      persona: p.persona || null
    }));

    this.core = new GameCore(players, () => this._publish(), {
      scriptId: this.scriptId,
      storytellerId: this.uid
    });
    this.mySeat = -1;
    await fb.update(roomRef(this.code, "meta"), { status: "playing" });
    this._persistResume();
    this.core.start();
    return { ok: true };
  }

  _publish() {
    if (!this.core) return;
    saveHostCore(this.code, this.core);
    this.view = this.core.getStorytellerView();
    this.chat = this.core.getAllChat().slice(-VIEW_CHAT_LIMIT);
    this._persistResume();
    this._notify();

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
      fb.update(roomRef(this.code), updates).catch((e) => console.error("视图发布失败:", e));
    }
  }

  _handleRemoteAction(a) {
    if (!this.core || !a || !a.uid) return;
    if (a.kind === "chat") {
      this.core.chatFrom(a.uid, a.text, a.toSeat == null ? null : a.toSeat);
    } else if (a.kind === "action" && a.action) {
      this.core.dispatchFor(a.uid, a.action, { isHost: a.uid === this.uid });
    }
  }

  sendChat() {
    return { ok: false, error: "说书人暂不参与玩家聊天" };
  }
  nightAction() {
    return { ok: false, error: "说书人不能执行玩家夜间行动" };
  }
  nominate() {
    return { ok: false, error: "说书人不能提名" };
  }
  vote() {
    return { ok: false, error: "说书人不能投票" };
  }
  slayerShot() {
    return { ok: false, error: "说书人不能使用玩家能力" };
  }
  endDay() {
    return this.core ? this.core.dispatchStoryteller({ type: "endDay" }) : { ok: false, error: "游戏尚未开始" };
  }
  storytellerAction(action) {
    return this.core ? this.core.dispatchStoryteller(action) : { ok: false, error: "游戏尚未开始" };
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
    const uid = await ensureAuth();
    const upper = code.toUpperCase().trim();
    const metaSnap = await fb.get(roomRef(upper, "meta"));
    if (!metaSnap.exists()) throw new Error("房间不存在");
    if ((metaSnap.val().status || "lobby") !== "lobby") throw new Error("游戏已开始,无法加入");

    await fb.set(roomRef(upper, "lobby", uid), {
      name: playerName,
      ai: false,
      role: "player",
      order: Date.now()
    });
    const session = new FirebaseGuestSession(upper, uid, playerName);
    session._persistResume();
    session._init();
    return session;
  }

  static async resumeSaved(saved = readResume(), uid = null, meta = null) {
    if (!saved?.code) return null;
    const finalUid = uid || await ensureAuth();
    let finalMeta = meta;
    if (!finalMeta) {
      const metaSnap = await fb.get(roomRef(saved.code, "meta"));
      if (!metaSnap.exists()) {
        clearResume(saved.code);
        return null;
      }
      finalMeta = metaSnap.val() || {};
    }
    const session = new FirebaseGuestSession(saved.code, finalUid, saved.name || "玩家");
    session.status = finalMeta.status || "lobby";
    session.scriptId = finalMeta.scriptId || saved.scriptId || "trouble-brewing";
    session.storytellerName = finalMeta.storytellerName || "说书人";
    session._persistResume();
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
