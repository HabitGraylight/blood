/**
 * 单机会话:一名真人 + 若干 AI,全部逻辑在本地运行。
 * 对 UI 暴露与联机会话完全一致的接口(subscribe / getView / getChat / 各动作)。
 */
import { GameCore, AI_PERSONAS } from "./gameCore.js";
import { createRng, randomSeed } from "../core/rng.js";

const HUMAN_ID = "human";

export class LocalSession {
  constructor({ playerName, playerCount, scriptId, seed }) {
    this.listeners = new Set();
    this.isHost = true; // 单机模式下真人拥有房主权限(宣布黄昏)
    this.mode = "single";

    const rng = createRng(seed != null ? seed : randomSeed());
    const personas = rng.shuffle(AI_PERSONAS).slice(0, playerCount - 1);
    const players = personas.map((p) => ({
      id: `ai-${p.name}`, name: p.name, isHuman: false, persona: p.persona
    }));
    // 真人随机入座
    const humanSeat = rng.int(playerCount);
    players.splice(humanSeat, 0, {
      id: HUMAN_ID, name: playerName || "你", isHuman: true, persona: null
    });

    this.scriptId = scriptId || "trouble-brewing";
    this.core = new GameCore(players, () => this._notify(), { scriptId: this.scriptId });
    this.mySeat = this.core.seatOf(HUMAN_ID);
    this.core.start();
  }

  /* ---------- UI 接口 ---------- */

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
    this.core.dispose();
    this.listeners.clear();
  }
}
