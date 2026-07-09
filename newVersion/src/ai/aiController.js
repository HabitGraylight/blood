/**
 * AI 玩家决策器。
 * 每个 AI 只依赖自己的 playerView(与真人玩家所见完全一致)做决策。
 * 配置了 LLM 时用大模型推理;否则回退到启发式策略,保证离线可玩。
 * LLM 调用失败也会静默回退,游戏永远不会卡死。
 */
import { chatComplete, extractJSON, isLLMConfigured, llmBudgetTier } from "./llm.js";
import {
  buildSystemPrompt, nightActionPrompt, speechPrompt,
  nominationPrompt, votePrompt, whisperPrompt, memoPrompt,
  initiateWhisperPrompt, slayerShotPrompt
} from "./prompts.js";
import { getScript, roleName as scriptRoleName } from "../scripts/registry.js";

const DEFAULT_TRAITS = { aggr: 0.5, talk: 0.5 };

export class AIPlayer {
  constructor(seat, persona, rng, opts = {}) {
    this.seat = seat;
    this.persona = persona;
    this.rng = rng;
    // 数值化人格特征:aggr 激进度(提名/推票倾向),talk 多话度;启发式路径也用
    this.traits = { ...DEFAULT_TRAITS, ...(opts.traits || {}) };
    // 跨回合长期记忆 { summary, updatedDay },每个白天结束后浓缩更新
    this.memo = opts.memo || null;
  }

  /* ---------------- LLM 封装 ---------------- */

  async _ask(view, userPrompt, options = {}) {
    if (!isLLMConfigured()) return null;
    const messages = [
      { role: "system", content: buildSystemPrompt(view, this.persona, this.memo) },
      { role: "user", content: userPrompt }
    ];
    try {
      let text = await chatComplete(messages, options);
      let parsed = extractJSON(text);
      if (!parsed) {
        // 解析失败重试一次:附上原回复,低温度要求纯 JSON
        text = await chatComplete(
          [
            ...messages,
            { role: "assistant", content: String(text).slice(0, 400) },
            { role: "user", content: "你的回复无法解析。只输出一个 JSON 对象,不要输出任何其他文字。" }
          ],
          { ...options, temperature: 0.3 }
        );
        parsed = extractJSON(text);
      }
      return parsed;
    } catch (err) {
      console.warn(`AI(${this.seat}) LLM 调用失败,回退启发式:`, err.message);
      return null;
    }
  }

  /** 白天结束后更新推理档案(LLM 不可用或低预算档时静默跳过) */
  async updateMemo(view, chatHistory) {
    if (llmBudgetTier() === "low") return;
    const result = await this._ask(view, memoPrompt(view, chatHistory, this.memo), {
      maxTokens: 700,
      temperature: 0.3
    });
    if (!result) return;
    // 新格式:按座位的结构化推理档案
    if (result.players && typeof result.players === "object" && !Array.isArray(result.players)) {
      const players = {};
      for (const [k, v] of Object.entries(result.players)) {
        if (typeof v === "string" && v.trim()) players[k] = v.trim().slice(0, 80);
      }
      if (Object.keys(players).length) {
        this.memo = {
          updatedDay: view.day,
          players,
          self: typeof result.self === "string" ? result.self.trim().slice(0, 80) : "",
          plan: typeof result.plan === "string" ? result.plan.trim().slice(0, 100) : ""
        };
        return;
      }
    }
    // 兼容旧格式回复
    if (typeof result.memo === "string" && result.memo.trim()) {
      this.memo = { summary: result.memo.trim().slice(0, 400), updatedDay: view.day };
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
    const result = await this._ask(view, nightActionPrompt(view, pa), { temperature: 0.6 });
    if (result && Array.isArray(result.targets)) {
      // 提示词中的座位号从 1 开始(与界面一致),转回引擎的 0 起座位
      // 只接受存活目标:对死者使用能力等于浪费(LLM 偶尔会忽视死亡标记)
      const targets = result.targets
        .map((t) => Number(t) - 1)
        .filter((t) => view.seats[t] && view.seats[t].alive && (!pa.notSelf || t !== this.seat));
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
      const script = getScript(view.scriptId);
      const bluffName = bluffs.length ? scriptRoleName(script, this.rng.pick(bluffs)) : "村民";
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

    const result = await this._ask(view, nominationPrompt(view, chatHistory, candidates), { temperature: 0.6 });
    if (result !== null && "nominate" in result) {
      const n = result.nominate;
      if (n === null) return null;
      // 提示词中的座位号从 1 开始,转回引擎的 0 起座位
      const seat = Number(n) - 1;
      if (candidates.includes(seat)) return seat;
      return null;
    }
    return this._heuristicNomination(view, candidates);
  }

  _heuristicNomination(view, candidates) {
    // 提名倾向随人格激进度浮动,避免千人一面
    if (!this.rng.chance(0.15 + 0.5 * this.traits.aggr)) return null;
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
    // 低预算档:普通投票走启发式,只有关键投票才消耗 LLM 调用
    if (llmBudgetTier() === "low" && !this._isCriticalVote(view, cv)) {
      return this._heuristicVote(view, cv);
    }
    const result = await this._ask(view, votePrompt(view, chatHistory, cv), { maxTokens: 200, temperature: 0.55 });
    if (result && typeof result.vote === "boolean") return result.vote;
    return this._heuristicVote(view, cv);
  }

  /** 关键投票:被提名的是自己/队友,或已到残局 */
  _isCriticalVote(view, cv) {
    if (cv.nominee === this.seat) return true;
    if (this._evilTeamSeats(view).has(cv.nominee)) return true;
    return view.seats.filter((s) => s.alive).length <= 4;
  }

  _heuristicVote(view, cv) {
    if (cv.nominee === this.seat) return false;
    const team = this._evilTeamSeats(view);
    if (this._isEvil(view)) {
      // 邪恶:压票保队友(偶尔卖队友做戏),推票处决好人
      if (team.has(cv.nominee)) return this.rng.chance(0.12);
      return this.rng.chance(0.5 + 0.4 * this.traits.aggr);
    }
    // 死人省着用遗书票
    if (!view.you.alive) return this.rng.chance(0.25);
    return this.rng.chance(0.3 + 0.4 * this.traits.aggr);
  }

  /* ---------------- 杀手开枪 ---------------- */

  /**
   * 自认为是杀手且能力未用时,决定是否公开开枪。
   * @returns 目标座位(0起)或 null(暂不开枪)
   */
  async decideSlayerShot(view, chatHistory) {
    const candidates = view.seats
      .filter((s) => s.alive && s.seat !== this.seat)
      .map((s) => s.seat);
    if (!candidates.length) return null;
    const result = await this._ask(view, slayerShotPrompt(view, chatHistory, candidates), {
      maxTokens: 200,
      temperature: 0.4
    });
    if (result && result.target != null) {
      const seat = Number(result.target) - 1;
      if (candidates.includes(seat)) return seat;
    }
    return null;
  }

  /* ---------------- 主动私聊 ---------------- */

  /**
   * 主动向某玩家发起私聊。
   * @param target { seat, name, isTeammate, isHuman }
   * @returns 私聊文本或 null(决定不发)
   */
  async initiateWhisper(view, chatHistory, target) {
    const result = await this._ask(view, initiateWhisperPrompt(view, chatHistory, target), {
      maxTokens: 200
    });
    if (result && typeof result.whisper === "string" && result.whisper.trim()) {
      return result.whisper.trim().slice(0, 200);
    }
    return this._heuristicInitiateWhisper(view, target);
  }

  _heuristicInitiateWhisper(view, target) {
    if (this._isEvil(view) && target.isTeammate) {
      const goods = view.seats.filter(
        (s) => s.alive && !this._evilTeamSeats(view).has(s.seat)
      );
      const mark = goods.length ? this.rng.pick(goods).name : "谁";
      return this.rng.pick([
        `今天把票往${mark}身上引,我发言配合你。`,
        `我准备跳个村民身份,待会你帮我做证。`,
        `${mark}的信息对我们威胁最大,想办法让大家怀疑他。`,
        `稳住,别急着说话,先看好人自己咬起来。`
      ]);
    }
    return this.rng.pick([
      "你是什么身份?我这边有点信息,可以互相验证一下。",
      `你怎么看今天的局势?我总觉得有人发言不对劲。`,
      "私下说,我拿到了一条重要信息,你先告诉我你的身份我再决定说不说。",
      "咱们俩交换下情报?我不想在广场上暴露。"
    ]);
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
