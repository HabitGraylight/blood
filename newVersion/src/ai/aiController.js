/**
 * AI 玩家决策器。
 * 每个 AI 只依赖自己的 playerView(与真人玩家所见完全一致)做决策。
 * 配置了 LLM 时用大模型推理;否则回退到启发式策略,保证离线可玩。
 * LLM 调用失败也会静默回退,游戏永远不会卡死。
 */
import { chatComplete, extractJSON, isLLMConfigured } from "./llm.js";
import {
  buildSystemPrompt, nightActionPrompt, speechPrompt,
  nominationPrompt, votePrompt, whisperPrompt
} from "./prompts.js";
import { roleName } from "../core/data/roles.js";

export class AIPlayer {
  constructor(seat, persona, rng) {
    this.seat = seat;
    this.persona = persona;
    this.rng = rng;
    this.suspicion = {}; // seat -> 分数,启发式用
  }

  /* ---------------- LLM 封装 ---------------- */

  async _ask(view, userPrompt, options = {}) {
    if (!isLLMConfigured()) return null;
    try {
      const text = await chatComplete(
        [
          { role: "system", content: buildSystemPrompt(view, this.persona) },
          { role: "user", content: userPrompt }
        ],
        options
      );
      return extractJSON(text);
    } catch (err) {
      console.warn(`AI(${this.seat}) LLM 调用失败,回退启发式:`, err.message);
      return null;
    }
  }

  /* ---------------- 通用工具 ---------------- */

  _aliveSeats(view, excludeSelf = true) {
    return view.seats
      .filter((s) => s.alive && (!excludeSelf || s.seat !== this.seat))
      .map((s) => s.seat);
  }

  _isEvil(view) {
    return view.you.alignment === "evil";
  }

  _evilTeamSeats(view) {
    const info = view.you.evilInfo;
    if (!info) return new Set(this._isEvil(view) ? [this.seat] : []);
    return new Set([info.demonSeat, ...info.minionSeats, this.seat]);
  }

  /** 启发式随机挑目标:邪恶避开队友,善良均匀随机 */
  _pickTargets(view, count, { avoidEvilTeam = false, notSelf = false } = {}) {
    let pool = this._aliveSeats(view, notSelf);
    if (!notSelf && !pool.includes(this.seat) && view.you.alive) pool.push(this.seat);
    if (avoidEvilTeam) {
      const team = this._evilTeamSeats(view);
      const filtered = pool.filter((s) => !team.has(s));
      if (filtered.length >= count) pool = filtered;
    }
    const picked = [];
    const shuffled = this.rng.shuffle(pool);
    for (const s of shuffled) {
      if (picked.length >= count) break;
      if (!picked.includes(s)) picked.push(s);
    }
    return picked;
  }

  /* ---------------- 夜间行动 ---------------- */

  async decideNightAction(view) {
    const pa = view.pendingAction;
    const result = await this._ask(view, nightActionPrompt(view, pa));
    if (result && Array.isArray(result.targets)) {
      const targets = result.targets
        .map(Number)
        .filter((t) => view.seats[t] && (!pa.notSelf || t !== this.seat));
      if (targets.length === pa.targets && new Set(targets).size === targets.length) {
        return targets;
      }
    }
    return this._heuristicNightAction(view, pa);
  }

  _heuristicNightAction(view, pa) {
    switch (pa.roleId) {
      case "imp": {
        // 杀死非队友;偶尔传位(队友存活且随机)
        const team = this._evilTeamSeats(view);
        const aliveMinions = [...team].filter(
          (s) => s !== this.seat && view.seats[s] && view.seats[s].alive
        );
        if (aliveMinions.length && this.rng.chance(0.06)) return [this.seat];
        return this._pickTargets(view, 1, { avoidEvilTeam: true, notSelf: true });
      }
      case "poisoner":
        return this._pickTargets(view, 1, { avoidEvilTeam: true, notSelf: true });
      case "monk":
      case "butler":
      case "ravenkeeper":
        return this._pickTargets(view, pa.targets, { notSelf: true });
      case "fortuneteller":
      default:
        return this._pickTargets(view, pa.targets, { notSelf: pa.notSelf });
    }
  }

  /* ---------------- 白天发言 ---------------- */

  async speak(view, chatHistory) {
    const result = await this._ask(view, speechPrompt(view, chatHistory), { maxTokens: 300 });
    if (result && typeof result.speech === "string" && result.speech.trim()) {
      return result.speech.trim().slice(0, 200);
    }
    return this._heuristicSpeech(view);
  }

  _heuristicSpeech(view) {
    const you = view.you;
    const lastInfo = you.privateLog.filter((l) => l.kind === "info").slice(-1)[0];

    if (this._isEvil(view)) {
      const bluffs = (you.evilInfo && you.evilInfo.bluffs) || [];
      const bluffName = bluffs.length ? roleName(this.rng.pick(bluffs)) : "村民";
      const targets = this._pickTargets(view, 1, { avoidEvilTeam: true, notSelf: true });
      const lines = [
        `我是${bluffName},昨晚没什么特别的信息。`,
        `我觉得${targets.length ? view.seats[targets[0]].name : "有人"}的发言有点问题,大家注意一下。`,
        "先听听信息型角色怎么说吧,现在下结论太早了。",
        "我的信息暂时不方便公开,免得被投毒者针对。"
      ];
      return this.rng.pick(lines);
    }

    if (lastInfo && this.rng.chance(0.75)) {
      return `我是${you.roleName},我的信息:${lastInfo.text}`;
    }
    const lines = [
      "大家先把首夜信息报一报吧,交叉验证一下。",
      "我先听大家的,有矛盾的信息我们再对质。",
      `我是${you.roleName},信息稍后再说,先观察一下。`,
      "谁的发言前后矛盾,今天就提名谁。"
    ];
    return this.rng.pick(lines);
  }

  /* ---------------- 提名 ---------------- */

  async decideNomination(view, chatHistory) {
    if (!view.canNominate) return null;
    const candidates = view.seats
      .filter((s) => s.alive && !view.nominatedToday.includes(s.seat))
      .map((s) => s.seat);
    if (!candidates.length) return null;

    const result = await this._ask(view, nominationPrompt(view, chatHistory, candidates));
    if (result !== null && "nominate" in result) {
      const n = result.nominate;
      if (n === null) return null;
      if (candidates.includes(Number(n))) return Number(n);
      return null;
    }
    return this._heuristicNomination(view, candidates);
  }

  _heuristicNomination(view, candidates) {
    // 大多数时候不主动提名,避免刷屏
    if (!this.rng.chance(0.4)) return null;
    const team = this._evilTeamSeats(view);
    const pool = this._isEvil(view)
      ? candidates.filter((s) => !team.has(s))
      : candidates.filter((s) => s !== this.seat);
    if (!pool.length) return null;
    return this.rng.pick(pool);
  }

  /* ---------------- 投票 ---------------- */

  async decideVote(view, chatHistory) {
    const cv = view.currentVote;
    if (!cv) return false;
    const result = await this._ask(view, votePrompt(view, chatHistory, cv), { maxTokens: 200 });
    if (result && typeof result.vote === "boolean") return result.vote;
    return this._heuristicVote(view, cv);
  }

  _heuristicVote(view, cv) {
    if (cv.nominee === this.seat) return false;
    const team = this._evilTeamSeats(view);
    if (this._isEvil(view)) {
      // 邪恶:压票保队友(偶尔卖队友做戏),推票处决好人
      if (team.has(cv.nominee)) return this.rng.chance(0.12);
      return this.rng.chance(0.7);
    }
    // 死人省着用遗书票
    if (!view.you.alive) return this.rng.chance(0.25);
    return this.rng.chance(0.5);
  }

  /* ---------------- 私聊回复 ---------------- */

  async replyWhisper(view, chatHistory, fromName, text) {
    const result = await this._ask(view, whisperPrompt(view, chatHistory, fromName, text), {
      maxTokens: 200
    });
    if (result && typeof result.reply === "string" && result.reply.trim()) {
      return result.reply.trim().slice(0, 200);
    }
    const lines = this._isEvil(view)
      ? ["我这边信息不多,你有什么发现?", "我觉得可以先信你,今天白天你打算怎么投?", "别声张,我怀疑有人在说谎,再观察一天。"]
      : ["我手上有点信息,但还想再验证一晚。", "你先告诉我你的身份,我看看和我的信息对不对得上。", "好,白天我们统一行动。"];
    return this.rng.pick(lines);
  }
}
