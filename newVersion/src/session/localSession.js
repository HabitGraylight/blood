import { GameCore, AI_PERSONAS } from "./gameCore.js";
import { createRng, randomSeed } from "../core/rng.js";

const HUMAN_ID = "human";
const STORAGE_KEY = "botc.local.session.v1";

export class LocalSession {
  constructor({ playerName, playerCount, scriptId, seed, snapshot, aiStoryteller = true } = {}) {
    this.listeners = new Set();
    this.isHost = true;
    this.mode = "single";
    this._disposed = false;

    if (snapshot?.core) {
      this.scriptId = snapshot.scriptId || snapshot.core.scriptId || "trouble-brewing";
      this.core = GameCore.hydrate(snapshot.core, () => this._handleUpdate());
      this.mySeat = this.core.seatOf(HUMAN_ID);
      this.playerName = snapshot.playerName || this.core.state.players[this.mySeat]?.name || "我";
      this.playerCount = this.core.state.players.length;
      this.core.start();
      this._save();
      return;
    }

    const rng = createRng(seed != null ? seed : randomSeed());
    const total = playerCount || 8;
    const personas = rng.shuffle(AI_PERSONAS).slice(0, total - 1);
    const players = personas.map((p) => ({
      id: `ai-${p.name}`,
      name: p.name,
      isHuman: false,
      persona: p.persona
    }));

    const humanSeat = rng.int(total);
    this.playerName = playerName || "我";
    this.playerCount = total;
    players.splice(humanSeat, 0, {
      id: HUMAN_ID,
      name: this.playerName,
      isHuman: true,
      persona: null
    });

    this.scriptId = scriptId || "trouble-brewing";
    this.core = new GameCore(players, () => this._handleUpdate(), {
      scriptId: this.scriptId,
      aiStoryteller
    });
    this.mySeat = this.core.seatOf(HUMAN_ID);
    this.core.start();
    this._save();
  }

  static resume() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const snapshot = JSON.parse(raw);
      if (!snapshot?.core?.engineState) return null;
      return new LocalSession({ snapshot });
    } catch (error) {
      console.warn("恢复单机游戏失败:", error);
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  static clearSaved() {
    localStorage.removeItem(STORAGE_KEY);
  }

  _handleUpdate() {
    this._save();
    this._notify();
  }

  _save() {
    if (this._disposed || !this.core) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: "single",
        playerName: this.playerName,
        playerCount: this.playerCount,
        scriptId: this.scriptId,
        savedAt: Date.now(),
        core: this.core.serialize()
      }));
    } catch (error) {
      console.warn("保存单机游戏失败:", error);
    }
  }

  subscribe(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _notify() {
    for (const cb of this.listeners) cb();
  }

  getView() {
    return this.core.getViewFor(HUMAN_ID);
  }

  getChat() {
    return this.core.getChatForSeat(this.mySeat);
  }

  sendChat(text, toSeat = null) {
    return this.core.chatFrom(HUMAN_ID, text, toSeat);
  }

  nightAction(targets) {
    return this.core.dispatchFor(HUMAN_ID, { type: "nightAction", targets });
  }

  nominate(nominee) {
    return this.core.dispatchFor(HUMAN_ID, { type: "nominate", nominee });
  }

  vote(up) {
    return this.core.dispatchFor(HUMAN_ID, { type: "vote", up });
  }

  slayerShot(target) {
    return this.core.dispatchFor(HUMAN_ID, { type: "slayerShot", target });
  }

  endDay() {
    return this.core.dispatchFor(HUMAN_ID, { type: "endDay" }, { isHost: true });
  }

  leave() {
    this._disposed = true;
    LocalSession.clearSaved();
    this.core.dispose();
    this.listeners.clear();
  }
}
