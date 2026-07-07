/**
 * 游戏引擎:权威状态机。
 * 状态完全可 JSON 序列化;所有变更通过 dispatch(action) 进行,
 * 因此单机模式与联机模式(房主端为权威)共用同一套逻辑。
 *
 * 阶段流转:
 *   setup -> night(首夜) -> day(discussion/voting) -> night -> day ... -> end
 */
import { getScript, TEAM } from "../scripts/registry.js";
import { assignRoles, effectiveRole, hasRealAbility } from "./setup.js";
import { createRng, randomSeed } from "./rng.js";
import {
  washerwomanInfo, librarianInfo, investigatorInfo, chefInfo, empathInfo,
  fortuneTellerInfo, undertakerInfo, ravenkeeperInfo, spyGrimoire,
  demonFirstNightInfo, minionFirstNightInfo, registersAsDemon, registrationOf
} from "./info.js";
import { checkWin, resolveVoteResult } from "./rules.js";

function roleNameFor(script, roleId) { return script.roles[roleId] ? script.roles[roleId].name : roleId; }

export class GameEngine {
  constructor(state, rng) {
    this.state = state;
    this.script = getScript(state.scriptId);
    this.roles = this.script.roles;
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
      mayorRedirectSeat: undefined,
      winner: null,
      winReason: null
    };
    const engine = new GameEngine(state, rng);
    engine._log(`游戏开始:${players.length} 名玩家,剧本《${script.name}》`);
    engine._beginNight();
    return engine;
  }

  static hydrate(state) {
    return new GameEngine(state);
  }

  /* ---------------- 公共入口 ---------------- */

  dispatch(action) {
    if (this.state.winner) return { ok: false, error: "游戏已结束" };
    const handlers = {
      nightAction: () => this._handleNightAction(action),
      nominate: () => this._handleNominate(action),
      vote: () => this._handleVote(action),
      slayerShot: () => this._handleSlayerShot(action),
      endDay: () => this._handleEndDay(action),
      storytellerSetInfoOverride: () => this._handleStorytellerSetInfoOverride(action),
      storytellerSetRegistration: () => this._handleStorytellerSetRegistration(action),
      storytellerSetNightDeath: () => this._handleStorytellerSetNightDeath(action),
      storytellerResolveMayor: () => this._handleStorytellerResolveMayor(action),
      storytellerAdvancePhase: () => this._handleStorytellerAdvancePhase(action)
    };
    const fn = handlers[action.type];
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
    // 中毒或酒鬼 → 能力失效/得到假信息
    return player.poisonedBy != null || player.role === "drunk";
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
      p.protectedBy = null;
    }
    // 中毒持续到黄昏后清除,已在 _beginDay 末尾处理;此处清除上一夜的毒(投毒者每夜重新选择)
    for (const p of s.players) p.poisonedBy = null;

    const isFirst = s.night === 1;
    this._log(isFirst ? "第一个夜晚降临,所有人闭上眼睛……" : `第 ${s.night} 个夜晚降临……`);

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

    // 构建夜间行动队列(按官方顺序;酒鬼按其自认为的角色入队)
    const order = isFirst ? this.script.nightOrder.first : this.script.nightOrder.other;
    s.nightQueue = [];
    for (const roleId of order) {
      for (const p of s.players) {
        if (effectiveRole(p) === roleId && (p.alive || roleId === "ravenkeeper")) {
          s.nightQueue.push({ seat: p.seat, roleId });
        }
      }
    }
    s.nightIndex = 0;
    this._advanceNight();
  }

  _advanceNight() {
    const s = this.state;
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
          prompt: this._nightPrompt(step.roleId)
        };
        return;
      }

      // 无需输入的角色:自动结算信息
      this._resolveInfoRole(player, step.roleId);
      s.nightIndex++;
    }
    this._endNight();
  }

  _shouldWake(player, roleId) {
    const s = this.state;
    // 守鸦人:只有当夜死亡才醒来
    if (roleId === "ravenkeeper") {
      return player.diedTonight;
    }
    if (!player.alive) return false;
    // 猩红夫人夜间位其实是"变身检查",在死亡结算时处理,夜里不唤醒
    if (roleId === "scarletwoman") return false;
    // 小恶魔首夜不杀人(队列里不会有,防御性判断)
    if (roleId === "imp" && s.night === 1) return false;
    return true;
  }

  _nightPrompt(roleId) {
    const prompts = {
      poisoner: "选择一名玩家下毒",
      monk: "选择一名玩家保护(不能是自己)",
      fortuneteller: "选择两名玩家,占卜他们之中是否有恶魔",
      butler: "选择一名玩家作为你的主人",
      imp: "选择一名玩家杀死(选择自己则传位给爪牙)",
      ravenkeeper: "你死了!选择一名玩家,得知他的真实角色"
    };
    return prompts[roleId] || "选择目标";
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
    this._resolveChoiceRole(player, pa.roleId, list);
    s.pendingAction = null;
    s.nightIndex++;
    this._advanceNight();
    return { ok: true };
  }

  /** 结算需要选择目标的角色 */
  _resolveChoiceRole(player, roleId, targets) {
    const s = this.state;
    const corrupt = this._isCorrupt(player);
    const real = hasRealAbility(player) && effectiveRole(player) === player.role;

    switch (roleId) {
      case "poisoner": {
        const target = s.players[targets[0]];
        if (!corrupt && real) target.poisonedBy = player.seat;
        this._tell(player.seat, `你对 ${target.name} 下了毒`, "action");
        break;
      }
      case "monk": {
        const target = s.players[targets[0]];
        if (!corrupt && real) target.protectedBy = player.seat;
        this._tell(player.seat, `你今晚保护了 ${target.name}`, "action");
        break;
      }
      case "fortuneteller": {
        const info = fortuneTellerInfo(s.players, player, targets, corrupt || !real, this.rng, this.script);
        this._tell(player.seat, info.text);
        break;
      }
      case "butler": {
        const target = s.players[targets[0]];
        player.master = target.seat;
        this._tell(player.seat, `你选择了 ${target.name} 作为主人,明天只有他投票你才能投票`, "action");
        break;
      }
      case "imp": {
        this._impKill(player, targets[0]);
        break;
      }
      case "ravenkeeper": {
        const info = ravenkeeperInfo(s.players, targets[0], corrupt || !real, this.rng, this.script);
        this._tell(player.seat, info.text);
        break;
      }
      default:
        break;
    }
  }

  /** 结算自动信息角色 */
  _resolveInfoRole(player, roleId) {
    const s = this.state;
    const corrupt = this._isCorrupt(player) || !hasRealAbility(player) || effectiveRole(player) !== player.role;
    const gen = {
      washerwoman: () => washerwomanInfo(s.players, player, corrupt, this.rng, this.script),
      librarian: () => librarianInfo(s.players, player, corrupt, this.rng, this.script),
      investigator: () => investigatorInfo(s.players, player, corrupt, this.rng, this.script),
      chef: () => chefInfo(s.players, player, corrupt, this.rng, this.script),
      empath: () => empathInfo(s.players, player, corrupt, this.rng, this.script),
      undertaker: () => {
        // 夜晚开始前,executedToday 保存的是刚结束的白天的处决
        if (s.executedToday == null) return null;
        return undertakerInfo(s.players, s.executedToday, corrupt, this.rng, this.script);
      },
      spy: () => (corrupt ? null : spyGrimoire(s.players, this.script))
    };
    const fn = gen[roleId];
    if (!fn) return;
    const info = fn();
    if (info) this._tell(player.seat, info.text);
  }

  /** 小恶魔杀人(含自杀传位、士兵/僧侣/镇长/猩红夫人交互) */
  _impKill(imp, targetSeat) {
    const s = this.state;
    const corrupt = this._isCorrupt(imp);
    let target = s.players[targetSeat];
    this._tell(imp.seat, `你选择了杀死 ${target.name}`, "action");

    if (corrupt) return; // 中毒的恶魔杀不死人

    // 自杀传位:一名存活爪牙变成小恶魔(优先猩红夫人)
    if (targetSeat === imp.seat) {
      this._kill(imp.seat, "demon-suicide");
      const minions = this._alive().filter((p) => this.roles[p.role].team === TEAM.MINION);
      if (minions.length) {
        const heir = minions.find((p) => p.role === "scarletwoman") || this.rng.pick(minions);
        heir.role = "imp";
        heir.believedRole = null;
        this._tell(heir.seat, "小恶魔死亡,你变成了新的小恶魔!");
      }
      this._checkWin("demon-suicide");
      return;
    }

    // 镇长替死:说书人可裁定;自动模式下用启发式随机转移
    if (target.role === "mayor" && !this._isCorrupt(target)) {
      if (s.mayorRedirectSeat !== undefined) {
        if (s.mayorRedirectSeat === null) return;
        const redirected = s.players[s.mayorRedirectSeat];
        if (redirected) target = redirected;
        s.mayorRedirectSeat = undefined;
      } else if (this.rng.chance(0.5)) {
        const others = this._alive().filter((p) => p.seat !== target.seat && p.seat !== imp.seat);
        if (others.length) target = this.rng.pick(others);
      }
    }

    // 士兵免疫 / 僧侣保护
    if (target.role === "soldier" && !this._isCorrupt(target)) return;
    if (target.protectedBy != null) return;
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

    // 猩红夫人:恶魔死亡且存活>=5 → 变身(处决/杀手场景;夜间自杀已单独处理)
    if (this.roles[player.role].team === TEAM.DEMON) {
      if (aliveBeforeDeath >= 5) {
        const sw = this._alive().find((p) => p.role === "scarletwoman" && p.poisonedBy == null);
        if (sw) {
          sw.role = "imp";
          sw.believedRole = null;
          this._tell(sw.seat, "恶魔死亡,你变成了新的小恶魔!");
        }
      }
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
    if (s.phase !== "day" || !["discussion", "whispers", "nominations"].includes(s.dayStage)) {
      return { ok: false, error: "现在不能提名" };
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

    // 圣女:首次被村民提名 → 提名者立刻被处决
    if (
      target.role === "virgin" && !target.usedAbility && target.alive &&
      !this._isCorrupt(target)
    ) {
      target.usedAbility = true;
      const reg = registrationOf(nom, this.rng, this.script);
      if (reg.team === TEAM.TOWNSFOLK) {
        this._log(`${nom.name} 提名圣女,被立刻处决!`, "execution");
        this._execute(nom.seat);
        this._nightfall();
        return { ok: true, virginTriggered: true };
      }
    }
    if (target.role === "virgin" && !target.usedAbility) target.usedAbility = true;

    // 进入投票:从被提名者左手边(下一个座位)开始顺时针
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
    return { ok: true };
  }

  _handleVote({ seat, up }) {
    const s = this.state;
    const cv = s.currentVote;
    if (!cv || s.dayStage !== "voting") return { ok: false, error: "现在不在投票中" };
    if (cv.order[cv.index] !== seat) return { ok: false, error: "还没轮到你投票" };

    const voter = s.players[seat];
    if (up === "master-up") cv.masterIntent = true;
    let effective = up === "master-up" ? true : !!up;

    // 管家:主人正在投票、已经赞成、或尚未被计票但声明赞成时,管家可投票
    if (
      effective && voter.alive && voter.role === "butler" &&
      voter.master != null && !this._isCorrupt(voter)
    ) {
      const masterIndex = cv.order.indexOf(voter.master);
      const masterAlreadyVoted = cv.votes[voter.master] === true;
      const masterIsCurrent = cv.order[cv.index] === voter.master;
      const masterWillVoteLater = masterIndex > cv.index && cv.masterIntent === true;
      if (!(masterAlreadyVoted || masterIsCurrent || masterWillVoteLater)) {
        effective = false;
        this._tell(seat, "你的主人没有投票,你的投票无效");
      }
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

  /* ---------------- 白天:杀手/结束白天 ---------------- */

  _handleSlayerShot({ seat, target }) {
    const s = this.state;
    if (s.phase !== "day" || !["discussion", "whispers", "nominations"].includes(s.dayStage)) return { ok: false, error: "现在不能使用能力" };
    const player = s.players[seat];
    const victim = s.players[target];
    if (!player.alive) return { ok: false, error: "死亡的玩家不能使用能力" };
    if (player.slayerUsed) return { ok: false, error: "你已经用过这个能力了" };
    // 任何玩家都可以"声称"杀手开枪 — 但只有真杀手有效
    player.slayerUsed = true;
    this._log(`${player.name} 声称杀手,对 ${victim.name} 开枪!`, "slayer");

    const isRealSlayer = player.role === "slayer" && !this._isCorrupt(player);
    if (isRealSlayer && victim.alive && registersAsDemon(victim, this.rng, this.script)) {
      this._log(`${victim.name} 死亡!`, "death");
      this._kill(target, "slayer");
    } else {
      this._log("什么都没有发生……");
    }
    return { ok: true };
  }

  _handleEndDay() {
    const s = this.state;
    if (s.phase !== "day" || !["discussion", "whispers", "nominations"].includes(s.dayStage)) return { ok: false, error: "现在不能结束白天" };

    if (s.onBlock && s.onBlock.seat != null) {
      const victim = s.players[s.onBlock.seat];
      this._log(`${victim.name} 被处决了。`, "execution");
      this._execute(victim.seat);
    } else {
      this._log("今天没有人被处决。");
      // 镇长胜利:三人存活且无处决
      if (!s.winner && this._alive().length === 3) {
        const mayor = this._alive().find((p) => p.role === "mayor" && !this._isCorrupt(p));
        if (mayor) {
          this._win("good", "只剩三名玩家存活且无人被处决,镇长带领善良阵营获胜!");
          return { ok: true };
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

  /** 处决(含圣徒判定)。不负责入夜,由调用方决定。 */
  _execute(seat) {
    const s = this.state;
    const player = s.players[seat];
    s.executedToday = seat;

    // 圣徒被处决 → 邪恶获胜(清醒时)
    if (player.role === "saint" && !this._isCorrupt(player)) {
      player.alive = false;
      this._win("evil", `圣徒 ${player.name} 被处决,邪恶阵营获胜!`);
      return;
    }
    this._kill(seat, "execution");
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

  _handleStorytellerResolveMayor({ redirectSeat }) {
    this.state.mayorRedirectSeat = redirectSeat == null ? null : Number(redirectSeat);
    const label = redirectSeat == null ? "无人替死" : this.state.players[redirectSeat]?.name || redirectSeat;
    this._note(`镇长夜间死亡转移裁定:${label}`, "mayor");
    return { ok: true };
  }

  _handleStorytellerAdvancePhase({ stage, durationMs = 0 }) {
    const s = this.state;
    if (s.phase === "night" && stage === "day") {
      this._endNight();
      return { ok: true };
    }
    if (s.phase !== "day") return { ok: false, error: "当前不能推进白天阶段" };
    if (stage === "nightfall") return this._handleEndDay();
    const allowed = new Set(["discussion", "whispers", "nominations"]);
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
