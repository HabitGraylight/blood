/**
 * 游戏引擎:权威状态机。
 * 状态完全可 JSON 序列化;所有变更通过 dispatch(action) 进行,
 * 因此单机模式与联机模式(房主端为权威)共用同一套逻辑。
 *
 * 阶段流转:
 *   setup -> night(首夜) -> day(discussion/voting) -> night -> day ... -> end
 *
 * 引擎只运行通用生命周期(夜间队列、死亡管线、提名/投票/处决、说书人裁定挂起/恢复),
 * 不包含任何具体角色逻辑。角色行为以 hook 的形式由剧本提供(script.behaviors),
 * 契约见 scripts/trouble-brewing-behaviors.js 顶部说明;引擎通过 _buildBehaviorContext
 * 暴露给行为模块的上下文 API 也在本文件中定义。
 */
import { getScript, TEAM, roleName as scriptRoleName } from "../scripts/registry.js";
import { assignRoles, effectiveRole, hasRealAbility } from "./setup.js";
import { createRng, randomSeed } from "./rng.js";
import { minionFirstNightInfo, demonFirstNightInfo } from "./info.js";
import { checkWin, resolveVoteResult } from "./rules.js";
import { DAY_ACTION_STAGES, isDayActionable } from "./constants.js";
import { hasStatus, normalizeGameState, setPoisonedBy, setProtectedBy } from "./state.js";

function roleNameFor(script, roleId) { return scriptRoleName(script, roleId); }

export class GameEngine {
  constructor(state, rng) {
    this.state = state;
    this.script = getScript(state.scriptId);
    this.roles = this.script.roles;
    this.behaviors = this.script.behaviors || { roles: {} };
    normalizeGameState(this.state);
    this.ctx = this._buildBehaviorContext();
    if (rng) {
      this.rng = rng;
    } else {
      // 反序列化:重放随机数流到上次的位置,保证结果可复现
      this.rng = createRng(state.seed);
      const target = state.rngDraws || 0;
      while (this.rng.draws < target) this.rng.next();
    }
  }

  /** 序列化为纯 JSON(联机同步/存档用) */
  serialize() {
    this.state.rngDraws = this.rng.draws;
    return JSON.parse(JSON.stringify(this.state));
  }

  /** 创建新对局 */
  static create(playerConfigs, options = {}) {
    const seed = options.seed != null ? options.seed : randomSeed();
    const rng = createRng(seed);
    const script = getScript(options.scriptId);
    const players = assignRoles(playerConfigs, rng, options.fixedRoles, script);
    const state = {
      seed,
      scriptId: script.id,
      scriptName: script.name,
      storytellerMode: options.storytellerMode || "auto",
      rngDraws: 0,
      phase: "night",
      dayStage: null,
      night: 1,
      day: 0,
      players,
      nightQueue: [],
      nightIndex: 0,
      pendingAction: null,
      pendingStorytellerDecision: null,
      stDecisionSeq: 0,
      setupFlags: {},
      nightKills: [],
      executedToday: null,
      nominations: [],
      nominatedToday: [], // 被提名过的座位
      nominatorsToday: [], // 提过名的座位
      onBlock: null, // { seat, votes }
      currentVote: null,
      log: [],
      announcements: [],
      storytellerNotes: [],
      dayStageEndsAt: null,
      winner: null,
      winReason: null,
      dailySummaries: [] // 每日摘要: [{day, text}], 白天结束时由 summarizer 填充
    };
    const engine = new GameEngine(state, rng);
    engine._log(`游戏开始:${players.length} 名玩家,剧本《${script.name}》`);
    engine._beginNight();
    return engine;
  }

  static hydrate(state) {
    return new GameEngine(state);
  }

  /* ---------------- 行为 hook 基础设施 ---------------- */

  _roleBehavior(roleId) {
    return (this.behaviors.roles && this.behaviors.roles[roleId]) || null;
  }

  _roleHook(roleId, name) {
    const rb = this._roleBehavior(roleId);
    return rb && typeof rb[name] === "function" ? rb[name] : null;
  }

  /**
   * 暴露给剧本行为模块的上下文。角色 hook 只应通过这里与引擎交互,
   * 这个对象就是"新增剧本可以依赖的引擎 API"。
   */
  _buildBehaviorContext() {
    const engine = this;
    return {
      get state() { return engine.state; },
      get script() { return engine.script; },
      get roles() { return engine.roles; },
      get rng() { return engine.rng; },
      // 输出
      log: (text, type) => engine._log(text, type),
      tell: (seat, text, kind) => engine._tell(seat, text, kind),
      note: (text, type) => engine._note(text, type),
      // 查询
      alive: () => engine._alive(),
      isCorrupt: (p) => engine._isCorrupt(p),
      /** 真实拥有能力且正以真实角色行动(排除酒鬼等伪装身份) */
      actsWithTrueAbility: (p) => hasRealAbility(p, engine.script) && effectiveRole(p) === p.role,
      stManual: () => engine._stManual(),
      roleName: (roleId) => roleNameFor(engine.script, roleId),
      roleHook: (roleId, name) => engine._roleHook(roleId, name),
      // 状态变更
      kill: (seat, cause) => engine._kill(seat, cause),
      execute: (seat) => engine._execute(seat),
      win: (winner, reason) => engine._win(winner, reason),
      checkWin: (cause) => engine._checkWin(cause),
      nightfall: () => engine._nightfall(),
      beginVote: (nominator, nominee) => engine._beginVote(nominator, nominee),
      resumeNight: () => engine._resumeNight(),
      // 恶魔击杀管线
      safeFromDemon: (target) => engine._safeFromDemon(target),
      demonKillFinal: (seat) => engine._demonKillFinal(seat),
      // 说书人裁定
      requestDecision: (dec) => engine._requestDecision(dec),
      requestInfoDecision: (player, roleId, corrupt, targets) =>
        engine._requestInfoDecision(player, roleId, corrupt, targets)
    };
  }

  /* ---------------- 公共入口 ---------------- */

  dispatch(action) {
    if (this.state.winner) return { ok: false, error: "游戏已结束" };
    // 有待裁定事项时,冻结普通玩家动作,直到说书人作出选择
    if (
      this.state.pendingStorytellerDecision &&
      !String(action.type).startsWith("storyteller")
    ) {
      return { ok: false, error: "等待说书人裁定" };
    }
    const handlers = {
      nightAction: () => this._handleNightAction(action),
      nominate: () => this._handleNominate(action),
      vote: () => this._handleVote(action),
      endDay: () => this._handleEndDay(action),
      storytellerDecide: () => this._handleStorytellerDecide(action),
      storytellerNarrate: () => this._handleStorytellerNarrate(action),
      storytellerSetInfoOverride: () => this._handleStorytellerSetInfoOverride(action),
      storytellerSetRegistration: () => this._handleStorytellerSetRegistration(action),
      storytellerSetNightDeath: () => this._handleStorytellerSetNightDeath(action),
      storytellerAdvancePhase: () => this._handleStorytellerAdvancePhase(action)
    };
    // 剧本专属动作(如杀手开枪)与引擎内建动作同级
    const scriptAction = this.behaviors.actions && this.behaviors.actions[action.type];
    const fn = handlers[action.type] || (scriptAction && (() => scriptAction(this.ctx, action)));
    if (!fn) return { ok: false, error: `未知动作: ${action.type}` };
    try {
      return fn() || { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ---------------- 日志工具 ---------------- */

  _log(text, type = "system") {
    this.state.log.push({ type, text, night: this.state.night, day: this.state.day, ts: Date.now() });
  }

  _tell(seat, text, kind = "info") {
    this.state.players[seat].privateLog.push({
      night: this.state.night, day: this.state.day, kind, text, ts: Date.now()
    });
  }

  _alive() {
    return this.state.players.filter((p) => p.alive);
  }

  _isCorrupt(player) {
    // 中毒或本身没有真实能力(如酒鬼) → 能力失效/得到假信息
    return hasStatus(player, "poisoned") || player.poisonedBy != null || !hasRealAbility(player, this.script);
  }

  /** 非 auto 模式:裁量点交给说书人(人类或 AI)决定 */
  _stManual() {
    return this.state.storytellerMode !== "auto";
  }

  /* ---------------- 夜晚 ---------------- */

  _beginNight() {
    const s = this.state;
    s.phase = "night";
    s.dayStage = null;
    s.pendingAction = null;
    s.nightKills = [];
    for (const p of s.players) {
      p.diedTonight = false;
      setProtectedBy(p, null);
    }
    // 中毒持续到黄昏后清除,已在 _beginDay 末尾处理;此处清除上一夜的毒(投毒者每夜重新选择)
    for (const p of s.players) setPoisonedBy(p, null);

    const isFirst = s.night === 1;
    this._log(isFirst ? "第一个夜晚降临,所有人闭上眼睛……" : `第 ${s.night} 个夜晚降临……`);

    // 非 auto 模式:首夜前先让说书人复核剧本的设置期裁量(如酒鬼伪装、红鲱鱼)
    if (isFirst && this._stManual()) {
      if (this._requestSetupDecision()) return; // 挂起,裁定后继续
    }
    this._nightSetupAndQueue();
  }

  /** 设置期裁量:依次征询剧本定义的各个设置步骤。返回 true 表示已挂起。 */
  _requestSetupDecision() {
    const s = this.state;
    s.setupFlags = s.setupFlags || {};
    for (const step of this.behaviors.setupSteps || []) {
      if (s.setupFlags[step.id]) continue;
      const req = step.build(this.ctx);
      if (req) {
        this._requestDecision({ ...req, resume: { kind: "setup", step: step.id } });
        return true;
      }
      s.setupFlags[step.id] = true;
    }
    return false;
  }

  /** 首夜互认信息 + 构建夜间行动队列并开始推进 */
  _nightSetupAndQueue() {
    const s = this.state;
    const isFirst = s.night === 1;

    // 首夜:恶魔/爪牙互认信息(7人及以上)
    if (isFirst && s.players.length >= 7) {
      for (const p of s.players) {
        const team = this.roles[p.role].team;
        if (team === TEAM.MINION) {
          const info = minionFirstNightInfo(s.players, p, this.script);
          p.evilInfo = { demonSeat: info.demonSeat, minionSeats: info.minionSeats, bluffs: [] };
          this._tell(p.seat, info.text, "evil-info");
        } else if (team === TEAM.DEMON) {
          const info = demonFirstNightInfo(s.players, p, this.rng, this.script);
          p.evilInfo = { demonSeat: p.seat, minionSeats: info.minionSeats, bluffs: info.bluffs };
          this._tell(p.seat, info.text, "evil-info");
        }
      }
    }

    // 构建夜间行动队列(按剧本顺序;伪装身份者按其自认为的角色入队)
    const order = isFirst ? this.script.nightOrder.first : this.script.nightOrder.other;
    s.nightQueue = [];
    for (const roleId of order) {
      const rb = this._roleBehavior(roleId);
      for (const p of s.players) {
        if (effectiveRole(p) === roleId && (p.alive || (rb && rb.queueWhenDead))) {
          s.nightQueue.push({ seat: p.seat, roleId });
        }
      }
    }
    s.nightIndex = 0;
    this._advanceNight();
  }

  _advanceNight() {
    const s = this.state;
    if (s.pendingStorytellerDecision) return; // 等待说书人裁定
    while (s.nightIndex < s.nightQueue.length) {
      const step = s.nightQueue[s.nightIndex];
      const player = s.players[step.seat];
      const role = this.roles[step.roleId];

      if (!this._shouldWake(player, step.roleId)) {
        s.nightIndex++;
        continue;
      }

      if (role.input) {
        // 需要玩家选择 → 挂起等待 nightAction
        s.pendingAction = {
          seat: step.seat,
          roleId: step.roleId,
          targets: role.targets || 1,
          notSelf: !!role.notSelf,
          prompt: role.prompt || "选择目标"
        };
        return;
      }

      // 无需输入的角色:结算信息(非 auto 模式可能挂起等待裁定)
      const paused = this._resolveInfoRole(player, step.roleId);
      if (paused) return;
      s.nightIndex++;
    }
    this._endNight();
  }

  _shouldWake(player, roleId) {
    const wake = this._roleHook(roleId, "shouldWake");
    if (wake) return !!wake(this.ctx, player);
    return player.alive;
  }

  _handleNightAction({ seat, targets }) {
    const s = this.state;
    const pa = s.pendingAction;
    if (!pa || s.phase !== "night") return { ok: false, error: "现在不是你的行动时间" };
    if (pa.seat !== seat) return { ok: false, error: "还没轮到你行动" };
    const list = Array.isArray(targets) ? targets : [targets];
    if (list.length !== pa.targets) return { ok: false, error: `需要选择 ${pa.targets} 个目标` };
    for (const t of list) {
      if (!s.players[t]) return { ok: false, error: "无效目标" };
      if (pa.notSelf && t === seat) return { ok: false, error: "不能选择自己" };
    }

    const player = s.players[seat];
    s.pendingAction = null;
    const paused = this._resolveChoiceRole(player, pa.roleId, list);
    if (!paused) {
      this._resumeNight();
    }
    return { ok: true };
  }

  /** 结算需要选择目标的角色。返回 true 表示挂起等待说书人裁定。 */
  _resolveChoiceRole(player, roleId, targets) {
    const fn = this._roleHook(roleId, "resolveNightChoice");
    if (!fn) return false;
    return fn(this.ctx, player, targets) === true;
  }

  /** 结算自动信息角色。返回 true 表示挂起等待说书人裁定。 */
  _resolveInfoRole(player, roleId) {
    const fn = this._roleHook(roleId, "resolveNightInfo");
    if (!fn) return false;
    return fn(this.ctx, player) === true;
  }

  /** 推进夜间队列到下一位(角色结算或裁定恢复后调用) */
  _resumeNight() {
    this.state.nightIndex++;
    this._advanceNight();
  }

  /* ---------------- 恶魔击杀管线 ---------------- */

  /** 目标是否免受恶魔袭击(免疫类被动 + 保护状态) */
  _safeFromDemon(target) {
    if (!target || !target.alive) return true;
    const immune = this._roleHook(target.role, "immuneToDemon");
    if (immune && immune(this.ctx, target)) return true;
    return hasStatus(target, "protectedFromDemon") || target.protectedBy != null;
  }

  /** 恶魔袭击的最终结算(免疫/保护判定) */
  _demonKillFinal(targetSeat) {
    const target = this.state.players[targetSeat];
    if (this._safeFromDemon(target)) return;
    if (!target.alive) return; // 死人不能再死
    this._kill(target.seat, "demon");
  }

  /** 通用死亡处理 */
  _kill(seat, cause) {
    const s = this.state;
    const player = s.players[seat];
    if (!player.alive) return;
    const aliveBeforeDeath = this._alive().length;
    player.alive = false;
    player.diedTonight = s.phase === "night";
    if (s.phase === "night") s.nightKills.push(seat);

    if (cause === "demon-suicide") return; // 传位流程自行处理变身与胜负判定

    // 死亡反应 hook(如猩红夫人在恶魔死亡时变身)
    for (const p of this._alive()) {
      const fn = this._roleHook(p.role, "onDeath");
      if (fn) fn(this.ctx, p, { dead: player, cause, aliveBeforeDeath });
    }

    this._checkWin(cause, player);
  }

  _endNight() {
    const s = this.state;
    if (s.winner) return;
    s.phase = "day";
    s.day++;
    s.dayStage = "discussion";
    s.executedToday = null;
    s.nominations = [];
    s.nominatedToday = [];
    s.nominatorsToday = [];
    s.onBlock = null;
    s.currentVote = null;

    const deaths = s.nightKills.map((seat) => s.players[seat].name);
    if (s.day === 1) {
      this._log("天亮了,第 1 个白天开始。");
    } else if (deaths.length) {
      this._log(`天亮了。昨晚死亡的是:${deaths.join("、")}。`, "death");
    } else {
      this._log("天亮了。昨晚是平安夜,没有人死亡。");
    }
    this._checkWin("dawn");
  }

  /* ---------------- 白天:提名与投票 ---------------- */

  _handleNominate({ nominator, nominee }) {
    const s = this.state;
    if (!isDayActionable(s)) {
      return { ok: false, error: "现在不能提名" };
    }
    // 有说书人主持时,何时开放提名由说书人决定
    if (this._stManual() && s.dayStage !== "nominations") {
      return { ok: false, error: "说书人尚未开放提名" };
    }
    const nom = s.players[nominator];
    const target = s.players[nominee];
    if (!nom || !target) return { ok: false, error: "无效座位" };
    if (!nom.alive) return { ok: false, error: "死亡的玩家不能提名" };
    if (s.nominatorsToday.includes(nominator)) return { ok: false, error: "你今天已经提过名了" };
    if (s.nominatedToday.includes(nominee)) return { ok: false, error: "该玩家今天已被提名过" };
    if (!target.alive) return { ok: false, error: "不能提名死亡的玩家" };

    s.nominatorsToday.push(nominator);
    s.nominatedToday.push(nominee);
    this._log(`${nom.name} 提名了 ${target.name}`, "nomination");

    // 被提名者的被动反应(如圣女);返回真值表示已接管流程(处决/挂起裁定)
    const onNominated = this._roleHook(target.role, "onNominated");
    if (onNominated) {
      const res = onNominated(this.ctx, nom, target);
      if (res) return res;
    }

    this._beginVote(nominator, nominee);
    return { ok: true };
  }

  /** 进入投票:从被提名者左手边(下一个座位)开始顺时针 */
  _beginVote(nominator, nominee) {
    const s = this.state;
    const order = [];
    const n = s.players.length;
    for (let i = 1; i <= n; i++) {
      const p = s.players[(nominee + i) % n];
      if (p.alive || p.ghostVote) order.push(p.seat);
    }
    s.dayStage = "voting";
    s.currentVote = {
      nominator, nominee, order, index: 0,
      votes: {}, // seat -> true/false
      startedAt: Date.now()
    };
  }

  _handleVote({ seat, up }) {
    const s = this.state;
    const cv = s.currentVote;
    if (!cv || s.dayStage !== "voting") return { ok: false, error: "现在不在投票中" };
    if (cv.order[cv.index] !== seat) return { ok: false, error: "还没轮到你投票" };

    const voter = s.players[seat];
    if (up === "master-up") cv.masterIntent = true;
    let effective = up === "master-up" ? true : !!up;

    // 投票限制类被动(如管家):由角色 hook 判定本票是否有效
    if (effective && voter.alive) {
      const modify = this._roleHook(voter.role, "modifyVote");
      if (modify) effective = modify(this.ctx, voter, cv) !== false;
    }

    cv.votes[seat] = effective;
    if (effective && !voter.alive) {
      voter.ghostVote = false; // 用掉遗书票
    }
    cv.index++;

    if (cv.index >= cv.order.length) {
      this._finishVote();
    }
    return { ok: true };
  }

  _finishVote() {
    const s = this.state;
    const cv = s.currentVote;
    const count = Object.values(cv.votes).filter(Boolean).length;
    const aliveCount = this._alive().length;
    const nominee = s.players[cv.nominee];

    const result = resolveVoteResult(count, aliveCount, s.onBlock);
    s.nominations.push({
      nominator: cv.nominator, nominee: cv.nominee, votes: count,
      voters: Object.entries(cv.votes).filter(([, v]) => v).map(([k]) => Number(k)),
      result: result.outcome
    });

    if (result.outcome === "block") {
      s.onBlock = { seat: cv.nominee, votes: count };
      this._log(`${nominee.name} 获得 ${count} 票,达到处决线,待处决!`, "vote");
    } else if (result.outcome === "tie") {
      this._log(`${nominee.name} 获得 ${count} 票,与最高票持平——无人待处决。`, "vote");
      s.onBlock = { seat: null, votes: count }; // 平票:清空处决台但保留票数门槛
    } else {
      this._log(`${nominee.name} 获得 ${count} 票,未达到处决线。`, "vote");
    }

    s.currentVote = null;
    s.dayStage = "nominations";
  }

  /* ---------------- 白天:结束白天 ---------------- */

  _handleEndDay() {
    const s = this.state;
    if (!isDayActionable(s)) return { ok: false, error: "现在不能结束白天" };

    if (s.onBlock && s.onBlock.seat != null) {
      const victim = s.players[s.onBlock.seat];
      this._log(`${victim.name} 被处决了。`, "execution");
      this._execute(victim.seat);
    } else {
      this._log("今天没有人被处决。");
      // 无处决黄昏的被动 hook(如镇长胜利)
      if (!s.winner) {
        for (const p of this._alive()) {
          const fn = this._roleHook(p.role, "onDuskNoExecution");
          if (fn) fn(this.ctx, p);
          if (s.winner) return { ok: true };
        }
      }
    }

    this._nightfall();
    return { ok: true };
  }

  /** 入夜(若游戏尚未结束) */
  _nightfall() {
    if (this.state.winner) return;
    this.state.night++;
    this._beginNight();
  }

  /** 处决(含处决反应类被动,如圣徒)。不负责入夜,由调用方决定。 */
  _execute(seat) {
    const s = this.state;
    const player = s.players[seat];
    s.executedToday = seat;

    const fn = this._roleHook(player.role, "onExecuted");
    if (fn && fn(this.ctx, player)) return; // hook 已处理(如圣徒落败)
    this._kill(seat, "execution");
  }


  /* ---------------- 说书人裁量(决策挂起) ---------------- */

  /** 挂起一个说书人决策。调用方负责在挂起后中断当前流程。 */
  _requestDecision(dec) {
    const s = this.state;
    s.stDecisionSeq = (s.stDecisionSeq || 0) + 1;
    s.pendingStorytellerDecision = {
      id: s.stDecisionSeq,
      night: s.night,
      day: s.day,
      phase: s.phase,
      ...dec
    };
  }

  /**
   * 为夜间信息角色生成候选并挂起(候选唯一时直接结算不挂起)。
   * 候选项由剧本的 behaviors.buildNightInfoOptions 生成,引擎不认识任何具体角色。
   * 返回 true 表示已挂起。
   */
  _requestInfoDecision(player, roleId, corrupt, targets) {
    const s = this.state;
    const buildOptions = this.behaviors.buildNightInfoOptions;
    if (typeof buildOptions !== "function") return false;
    const built = buildOptions(roleId, {
      players: s.players,
      self: player,
      targets,
      executedSeat: s.executedToday,
      corrupt,
      rng: this.rng,
      script: this.script
    });
    if (!built) return false;
    if (built.options.length === 1) {
      this._tell(player.seat, built.options[0].text);
      return false;
    }
    const roleLabel = roleNameFor(this.script, effectiveRole(player));
    this._requestDecision({
      type: "night-info",
      seat: player.seat,
      roleId,
      title: `${player.name}(${roleLabel}${corrupt ? "·能力失效" : ""})的夜间信息`,
      detail: built.detail,
      options: built.options.map((o) => ({
        label: o.tag ? `${o.label}〔${o.tag}〕` : o.label,
        value: { text: o.text }
      })),
      defaultIndex: 0,
      resume: { kind: "night-info" }
    });
    return true;
  }

  _handleStorytellerDecide({ decisionId, choice, reason }) {
    const s = this.state;
    const d = s.pendingStorytellerDecision;
    if (!d) return { ok: false, error: "当前没有待裁定事项" };
    if (decisionId != null && decisionId !== d.id) return { ok: false, error: "该裁定已过期" };
    const idx = Number.isInteger(choice) && d.options[choice] ? choice : d.defaultIndex;
    const opt = d.options[idx];
    s.pendingStorytellerDecision = null;
    this._note(`${d.title} → ${opt.label}${reason ? `(理由:${String(reason).slice(0, 120)})` : ""}`, "decision");
    this._applyStDecision(d, opt);
    return { ok: true };
  }

  /** 说书人氛围旁白:写入公开日志 */
  _handleStorytellerNarrate({ text }) {
    const finalText = String(text || "").trim();
    if (!finalText) return { ok: false, error: "旁白不能为空" };
    this._log(finalText.slice(0, 200), "narration");
    return { ok: true };
  }

  /** 应用裁定结果并恢复被挂起的流程 */
  _applyStDecision(d, opt) {
    const s = this.state;
    const kind = d.resume && d.resume.kind;

    // 通用恢复:设置期步骤 / 夜间信息
    if (kind === "setup") {
      s.setupFlags = s.setupFlags || {};
      const step = (this.behaviors.setupSteps || []).find((x) => x.id === d.resume.step);
      if (step) step.apply(this.ctx, d, opt.value);
      s.setupFlags[d.resume.step] = true;
      if (!this._requestSetupDecision()) this._nightSetupAndQueue();
      return;
    }
    if (kind === "night-info") {
      this._tell(d.seat, opt.value.text);
      this._resumeNight();
      return;
    }

    // 剧本角色裁量点的恢复逻辑由剧本提供
    const handler = this.behaviors.resumeHandlers && this.behaviors.resumeHandlers[kind];
    if (handler) handler(this.ctx, d, opt);
  }

  /* ---------------- 说书人控制 ---------------- */

  _note(text, type = "storyteller") {
    this.state.storytellerNotes.push({ type, text, night: this.state.night, day: this.state.day, ts: Date.now() });
    this._log(`说书人裁定:${text}`, "storyteller");
  }

  _handleStorytellerSetInfoOverride({ seat, text, kind = "override" }) {
    const target = this.state.players[seat];
    if (!target) return { ok: false, error: "无效座位" };
    const finalText = String(text || "").trim();
    if (!finalText) return { ok: false, error: "信息不能为空" };
    this._tell(seat, finalText, kind);
    this._note(`向 ${target.name} 写入私密信息: ${finalText}`);
    return { ok: true };
  }

  _handleStorytellerSetRegistration({ seat, team, alignment, roleId, note }) {
    const target = this.state.players[seat];
    if (!target) return { ok: false, error: "无效座位" };
    const text = note || `${target.name} 本次注册为 ${alignment || "?"}/${team || "?"}/${roleId || "?"}`;
    this._note(text, "registration");
    return { ok: true };
  }

  _handleStorytellerSetNightDeath({ seat, dead = true }) {
    const target = this.state.players[seat];
    if (!target) return { ok: false, error: "无效座位" };
    if (dead) {
      this._kill(seat, "storyteller");
      if (this.state.phase === "night" && !this.state.nightKills.includes(seat)) this.state.nightKills.push(seat);
      this._note(`${target.name} 被手动标记为死亡`, "death");
    } else {
      target.alive = true;
      target.diedTonight = false;
      this.state.nightKills = this.state.nightKills.filter((s) => s !== seat);
      this._note(`${target.name} 被手动移出今晚死亡名单`, "death");
    }
    return { ok: true };
  }

  _handleStorytellerAdvancePhase({ stage, durationMs = 0 }) {
    const s = this.state;
    if (s.pendingStorytellerDecision) return { ok: false, error: "请先完成待裁定事项" };
    if (s.phase === "night" && stage === "day") {
      this._endNight();
      return { ok: true };
    }
    if (s.phase !== "day") return { ok: false, error: "当前不能推进白天阶段" };
    if (stage === "nightfall") return this._handleEndDay();
    const allowed = new Set(DAY_ACTION_STAGES);
    if (!allowed.has(stage)) return { ok: false, error: "未知阶段" };
    s.dayStage = stage;
    s.dayStageEndsAt = durationMs > 0 ? Date.now() + durationMs : null;
    this._log(stage === "whispers" ? "私聊时间开始。" : stage === "nominations" ? "说书人开放提名。" : "公开讨论继续。", "phase");
    return { ok: true };
  }

  /* ---------------- 胜负 ---------------- */

  _checkWin(cause) {
    const s = this.state;
    if (s.winner) return;
    const result = checkWin(s.players, this.script);
    if (result) this._win(result.winner, result.reason);
  }

  _win(winner, reason) {
    const s = this.state;
    if (s.winner) return;
    s.winner = winner;
    s.winReason = reason;
    s.phase = "end";
    this._log(reason, "end");
    this._log(
      "身份公开:" + s.players.map((p) => `${p.name}=${roleNameFor(this.script, p.role)}`).join(","),
      "end"
    );
  }
}
