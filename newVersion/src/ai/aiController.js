/**
 * AI 玩家决策器。
 * 每个 AI 只依赖自己的 playerView(与真人玩家所见完全一致)做决策。
 * 配置了 LLM 时用大模型推理;否则回退到启发式策略,保证离线可玩。
 * LLM 调用失败也会静默回退,游戏永远不会卡死。
 */
import { chatComplete, extractJSON, isLLMConfigured, llmBudgetTier, getLastUsage } from "./llm.js";
import {
  buildSystemPrompt, buildSharedSystemBlocks, buildPlayerSystemBlocks,
  buildPublicChatBlock,
  nightActionPrompt, speechPrompt,
  nominationPrompt, votePrompt, whisperPrompt, memoPrompt,
  initiateWhisperPrompt, dayActionPrompt
} from "./prompts.js";
import { getScript, roleName as scriptRoleName } from "../scripts/registry.js";

const DEFAULT_TRAITS = { aggr: 0.5, talk: 0.5 };

/**
 * 统一约束校验:游戏规则级别的合法性检查,杜绝 AI 幻觉导致的不合法动作。
 * 所有 LLM 决策结果在应用前都应通过本函数验证。
 *
 * @param {object} view playerView
 * @param {object} constraints 约束条件
 * @param {number[]} [constraints.targets] 目标座位数组(0起)
 * @param {number} [constraints.target] 单一目标座位(0起)
 * @param {boolean} [constraints.aliveOnly=true] 是否要求目标存活
 * @param {boolean} [constraints.notSelf=false] 是否禁止选择自己
 * @returns {boolean} true 表示通过约束校验
 */
export function enforceConstraints(view, constraints = {}) {
  const { targets, target, aliveOnly = true, notSelf = false } = constraints;
  const aliveSeats = new Set(view.seats.filter((s) => s.alive).map((s) => s.seat));

  if (targets !== undefined) {
    if (!Array.isArray(targets) || targets.length === 0) return false;
    for (const t of targets) {
      const seat = Number(t);
      if (aliveOnly && !aliveSeats.has(seat)) return false;
      if (notSelf && seat === view.seat) return false;
    }
    return true;
  }

  if (target !== undefined && target !== null) {
    const seat = Number(target);
    if (aliveOnly && !aliveSeats.has(seat)) return false;
    if (notSelf && seat === view.seat) return false;
    return true;
  }

  return true;
}

export class AIPlayer {
  constructor(seat, persona, rng, opts = {}) {
    this.seat = seat;
    this.persona = persona;
    this.rng = rng;
    // 数值化人格特征:aggr 激进度(提名/推票倾向),talk 多话度;启发式路径也用
    this.traits = { ...DEFAULT_TRAITS, ...(opts.traits || {}) };
    // 跨回合长期记忆 { summary, updatedDay },每个白天结束后浓缩更新
    this.memo = opts.memo || null;
    this.debugLogger = opts.debugLogger || null;
  }

  /* ---------------- LLM 封装 ---------------- */

  async _ask(view, userPrompt, options = {}) {
    const task = options.task || "unknown";
    const chatHistory = options.chatHistory || [];

    // 构建分层系统提示:只有 Block1(共享缓存) + Block3(玩家动态)
    const sharedBlocks = buildSharedSystemBlocks(view, chatHistory);
    const playerBlocks = buildPlayerSystemBlocks(view, this.persona, this.memo, chatHistory);
    const systemBlocks = [...sharedBlocks, ...playerBlocks];

    // 当天公开聊天放在 user 消息中(避免 MiniMax 对 system 段严格审核触发 new_sensitive)
    // 只注入当天:历史天由 daily_summaries/claim_summary/vote_history 压缩承担
    const chatBlock = buildPublicChatBlock(chatHistory, view.day, view.seat);
    const fullUserPrompt = chatBlock
      ? `${chatBlock}\n\n${userPrompt}`
      : userPrompt;

    const messages = [
      { role: "user", content: fullUserPrompt }
    ];

    const logBase = {
      actor: "ai-player",
      seat: this.seat,
      phase: `${view.phase || ""}:${view.dayStage || ""}:N${view.night || 0}:D${view.day || 0}`,
      task,
      input: { systemBlocks, messages }
    };

    if (!isLLMConfigured()) {
      await this.debugLogger?.record({ ...logBase, error: "LLM not configured" });
      return null;
    }

    try {
      let text = await chatComplete(messages, { ...options, systemBlocks });
      await this.debugLogger?.record({ ...logBase, output: text, usage: getLastUsage() });
      let parsed = extractJSON(text);
      if (!parsed) {
        const retryMessages = [
          ...messages,
          { role: "assistant", content: String(text).slice(0, 400) },
          { role: "user", content: "你的回复无法解析。只输出一个 JSON 对象,不要输出任何其他文字。" }
        ];
        text = await chatComplete(retryMessages, { ...options, systemBlocks, temperature: 0.3 });
        await this.debugLogger?.record({ ...logBase, task: `${task}:parse-retry`, input: { systemBlocks, messages: retryMessages }, output: text, usage: getLastUsage() });
        parsed = extractJSON(text);
      }
      return parsed;
    } catch (err) {
      await this.debugLogger?.record({ ...logBase, error: err.message });
      console.warn(`AI(${this.seat}) LLM 调用失败,回退启发式`, err.message);
      return null;
    }
  }
  async updateMemo(view, chatHistory) {
    if (llmBudgetTier() === "low") return;
    const result = await this._ask(view, memoPrompt(view, chatHistory, this.memo), {
      maxTokens: 900,
      temperature: 0.3,
      chatHistory,
      task: "memo"
    });
    if (!result) return;
    // 新格式:按座位的结构化推理档案
    if (result.players && typeof result.players === "object" && !Array.isArray(result.players)) {
      const players = {};
      for (const [k, v] of Object.entries(result.players)) {
        if (typeof v === "string" && v.trim()) players[k] = v.trim().slice(0, 80);
      }
      if (Object.keys(players).length) {
        // 假设世界:当前最可能的"恶魔是谁"分析,最多3个,跨天推理连贯性的锚点
        const worlds = Array.isArray(result.worlds)
          ? result.worlds
              .filter((w) => w && w.demon != null)
              .slice(0, 3)
              .map((w) => ({
                demon: String(w.demon).slice(0, 4),
                story: typeof w.story === "string" ? w.story.trim().slice(0, 60) : "",
                confidence: ["高", "中", "低"].includes(w.confidence) ? w.confidence : "中"
              }))
          : [];
        this.memo = {
          updatedDay: view.day,
          players,
          worlds,
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
    const result = await this._ask(view, nightActionPrompt(view, pa), { temperature: 0.3, chatHistory: [], task: `night:${pa.roleId}` });
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

  /**
   * 夜间选目标兜底启发式:策略由剧本角色定义的 aiNightPolicy 声明
   * (avoidEvilTeam / notSelf / selfTargetChance),未声明时均匀随机。
   */
  _heuristicNightAction(view, pa) {
    const script = getScript(view.scriptId);
    const role = script.roles[pa.roleId] || {};
    const policy = role.aiNightPolicy || {};
    if (policy.selfTargetChance) {
      // 如小恶魔传位:有存活队友时小概率选择自己
      const team = this._evilTeamSeats(view);
      const aliveMates = [...team].filter(
        (s) => s !== this.seat && view.seats[s] && view.seats[s].alive
      );
      if (aliveMates.length && this.rng.chance(policy.selfTargetChance)) return [this.seat];
    }
    return this._pickTargets(view, pa.targets, {
      avoidEvilTeam: !!policy.avoidEvilTeam,
      notSelf: policy.notSelf != null ? policy.notSelf : !!pa.notSelf
    });
  }

  /* ---------------- 白天发言 ---------------- */

  async speak(view, chatHistory) {
    const result = await this._ask(view, speechPrompt(view, chatHistory), { maxTokens: 800, temperature: 0.75, chatHistory, task: "speech" });
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

    const result = await this._ask(view, nominationPrompt(view, chatHistory, candidates), { temperature: 0.35, chatHistory, task: "nomination" });
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
    const result = await this._ask(view, votePrompt(view, chatHistory, cv), { maxTokens: 500, temperature: 0.3, chatHistory, task: "vote" });
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

  /* ---------------- 剧本白天动作(如杀手开枪) ---------------- */

  /**
   * 决定是否使用某个剧本声明的白天主动能力。
   * action 来自 view.availableDayActions,决策指引取自剧本配置的 aiGuide。
   * @returns 目标座位(0起)或 null(暂不使用)
   */
  async decideDayAction(view, chatHistory, action) {
    const policy = action.targetPolicy || { count: 1, aliveOnly: true, notSelf: true };
    const candidates = view.seats
      .filter((s) => (!policy.aliveOnly || s.alive) && (!policy.notSelf || s.seat !== this.seat))
      .map((s) => s.seat);
    if (!candidates.length) return null;
    const result = await this._ask(view, dayActionPrompt(view, chatHistory, candidates, action), {
      maxTokens: 500,
      temperature: 0.3,
      chatHistory,
      task: `day-action:${action.actionType}`
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
      maxTokens: 450,
      temperature: 0.7,
      chatHistory,
      task: "whisper:initiate"
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
      maxTokens: 450,
      temperature: 0.7,
      chatHistory,
      task: "whisper:reply"
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
