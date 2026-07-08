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
  demonFirstNightInfo, minionFirstNightInfo, registersAsDemon, registrationOf,
  buildNightInfoOptions
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
      slayerShot: () => this._handleSlayerShot(action),
      endDay: () => this._handleEndDay(action),
      storytellerDecide: () => this._handleStorytellerDecide(action),
      storytellerNarrate: () => this._handleStorytellerNarrate(action),
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
      p.protectedBy = null;
    }
    // 中毒持续到黄昏后清除,已在 _beginDay 末尾处理;此处清除上一夜的毒(投毒者每夜重新选择)
    for (const p of s.players) p.poisonedBy = null;

    const isFirst = s.night === 1;
    this._log(isFirst ? "第一个夜晚降临,所有人闭上眼睛……" : `第 ${s.night} 个夜晚降临……`);

    // 非 auto 模式:首夜前先让说书人复核设置期裁量(酒鬼伪装、红鲱鱼)
    if (isFirst && this._stManual()) {
      if (this._requestSetupDecision()) return; // 挂起,裁定后继续
    }
    this._nightSetupAndQueue();
  }

  /** 设置期裁量:依次征询酒鬼伪装、占卜师红鲱鱼。返回 true 表示已挂起。 */
  _requestSetupDecision() {
    const s = this.state;
    s.setupFlags = s.setupFlags || {};

    if (!s.setupFlags.drunk) {
      const drunk = s.players.find((p) => p.role === "drunk");
      if (drunk) {
        const inPlay = new Set(s.players.map((p) => p.role));
        const candidates = Object.values(this.roles)
          .filter((r) => r.team === TEAM.TOWNSFOLK && !inPlay.has(r.id));
        this._requestDecision({
          type: "setup-drunk",
          seat: drunk.seat,
          roleId: "drunk",
          title: "选择酒鬼的伪装身份",
          detail: `${drunk.name} 是酒鬼,他将自认为是一个不在场的村民角色并按其行动(但没有真实能力)。当前随机选择为【${roleNameFor(this.script, drunk.believedRole)}】。`,
          options: candidates.map((r) => ({
            label: `${r.name}${r.id === drunk.believedRole ? "(默认)" : ""}`,
            value: { roleId: r.id }
          })),
          defaultIndex: Math.max(0, candidates.findIndex((r) => r.id === drunk.believedRole)),
          resume: { kind: "setup", step: "drunk" }
        });
        return true;
      }
      s.setupFlags.drunk = true;
    }

    if (!s.setupFlags.redHerring) {
      // 酒鬼伪装可能刚被改成占卜师,此时场上尚无红鲱鱼,一并在此裁定
      const ft = s.players.find((p) => effectiveRole(p) === "fortuneteller");
      if (ft) {
        const current = s.players.find((p) => p.redHerring) || null;
        const goods = s.players.filter((p) => p.alignment === "good");
        this._requestDecision({
          type: "setup-redherring",
          seat: ft.seat,
          roleId: "fortuneteller",
          title: "选择占卜师的红鲱鱼",
          detail:
            "一名善良玩家将永远被占卜师的能力误判为恶魔(可以是占卜师本人)。" +
            (current ? `当前随机选择为 ${current.name}。` : ""),
          options: goods.map((p) => ({
            label: `${p.name}${current && p.seat === current.seat ? "(默认)" : ""}${p.seat === ft.seat ? "(占卜师本人)" : ""}`,
            value: { seat: p.seat }
          })),
          defaultIndex: Math.max(0, goods.findIndex((p) => current && p.seat === current.seat)),
          resume: { kind: "setup", step: "redHerring" }
        });
        return true;
      }
      s.setupFlags.redHerring = true;
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
          prompt: this._nightPrompt(step.roleId)
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
    s.pendingAction = null;
    const paused = this._resolveChoiceRole(player, pa.roleId, list);
    if (!paused) {
      s.nightIndex++;
      this._advanceNight();
    }
    return { ok: true };
  }

  /** 结算需要选择目标的角色。返回 true 表示挂起等待说书人裁定。 */
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
        if (this._stManual()) {
          return this._requestInfoDecision(player, "fortuneteller", corrupt || !real, targets);
        }
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
        return this._impKill(player, targets[0]);
      }
      case "ravenkeeper": {
        if (this._stManual()) {
          return this._requestInfoDecision(player, "ravenkeeper", corrupt || !real, targets);
        }
        const info = ravenkeeperInfo(s.players, targets[0], corrupt || !real, this.rng, this.script);
        this._tell(player.seat, info.text);
        break;
      }
      default:
        break;
    }
    return false;
  }

  /** 结算自动信息角色。返回 true 表示挂起等待说书人裁定。 */
  _resolveInfoRole(player, roleId) {
    const s = this.state;
    const corrupt = this._isCorrupt(player) || !hasRealAbility(player) || effectiveRole(player) !== player.role;

    // 非 auto 模式:可裁量的信息交给说书人选择
    if (this._stManual() && roleId !== "spy") {
      if (roleId === "undertaker" && s.executedToday == null) return false;
      return this._requestInfoDecision(player, roleId, corrupt, null);
    }

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

  /**
   * 小恶魔杀人(含自杀传位、士兵/僧侣/镇长/猩红夫人交互)。
   * 返回 true 表示挂起等待说书人裁定(传位继承/镇长替死)。
   */
  _impKill(imp, targetSeat) {
    const s = this.state;
    const corrupt = this._isCorrupt(imp);
    let target = s.players[targetSeat];
    this._tell(imp.seat, `你选择了杀死 ${target.name}`, "action");

    if (corrupt) return false; // 中毒的恶魔杀不死人

    // 自杀传位:一名存活爪牙变成小恶魔(优先猩红夫人)
    if (targetSeat === imp.seat) {
      this._kill(imp.seat, "demon-suicide");
      const minions = this._alive().filter((p) => this.roles[p.role].team === TEAM.MINION);
      if (!minions.length) {
        this._checkWin("demon-suicide");
        return false;
      }
      if (this._stManual() && minions.length > 1) {
        const swIndex = minions.findIndex((p) => p.role === "scarletwoman" && p.poisonedBy == null);
        this._requestDecision({
          type: "star-pass",
          seat: imp.seat,
          roleId: "imp",
          title: "小恶魔自杀:选择传位的爪牙",
          detail: "小恶魔杀死了自己,一名存活爪牙将变成新的小恶魔。官方惯例:清醒的猩红夫人优先。",
          options: minions.map((p) => ({
            label: `${p.name}(${this.roles[p.role].name})${p.poisonedBy != null ? "(中毒)" : ""}`,
            value: { seat: p.seat }
          })),
          defaultIndex: swIndex >= 0 ? swIndex : 0,
          resume: { kind: "star-pass" }
        });
        return true;
      }
      const heir = minions.find((p) => p.role === "scarletwoman" && p.poisonedBy == null) || this.rng.pick(minions);
      this._makeHeir(heir);
      this._checkWin("demon-suicide");
      return false;
    }

    // 镇长替死:说书人可裁定;自动模式下用启发式随机转移
    if (target.role === "mayor" && !this._isCorrupt(target)) {
      if (s.mayorRedirectSeat !== undefined) {
        if (s.mayorRedirectSeat === null) return false;
        const redirected = s.players[s.mayorRedirectSeat];
        if (redirected) target = redirected;
        s.mayorRedirectSeat = undefined;
      } else if (this._stManual()) {
        const others = this._alive().filter((p) => p.seat !== target.seat && p.seat !== imp.seat);
        this._requestDecision({
          type: "mayor-redirect",
          seat: target.seat,
          roleId: "mayor",
          title: "镇长被恶魔袭击:是否转移死亡",
          detail: `恶魔选择杀死镇长 ${target.name}。按镇长能力,你可以让另一名玩家代替他死亡(士兵免疫与僧侣保护仍然生效)。`,
          options: [
            { label: `不转移,${target.name} 承受袭击`, value: { seat: target.seat } },
            ...others.map((p) => ({ label: `转移给 ${p.name}`, value: { seat: p.seat } }))
          ],
          defaultIndex: 0,
          resume: { kind: "imp-kill-final", impSeat: imp.seat }
        });
        return true;
      } else if (this.rng.chance(0.5)) {
        const others = this._alive().filter((p) => p.seat !== target.seat && p.seat !== imp.seat);
        if (others.length) target = this.rng.pick(others);
      }
    }

    this._impKillFinal(target.seat);
    return false;
  }

  /** 恶魔袭击的最终结算(士兵/保护判定) */
  _impKillFinal(targetSeat) {
    const target = this.state.players[targetSeat];
    if (target.role === "soldier" && !this._isCorrupt(target)) return;
    if (target.protectedBy != null) return;
    if (!target.alive) return; // 死人不能再死
    this._kill(target.seat, "demon");
  }

  /** 爪牙变身为小恶魔 */
  _makeHeir(heir) {
    heir.role = "imp";
    heir.believedRole = null;
    this._tell(heir.seat, "小恶魔死亡,你变成了新的小恶魔!");
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

    // 圣女:首次被村民提名 → 提名者立刻被处决
    if (
      target.role === "virgin" && !target.usedAbility && target.alive &&
      !this._isCorrupt(target)
    ) {
      target.usedAbility = true;
      // 非 auto 模式:间谍提名圣女时,注册结果由说书人裁定;其余角色注册无歧义
      if (this._stManual() && nom.role === "spy") {
        this._requestDecision({
          type: "virgin-check",
          seat: target.seat,
          roleId: "virgin",
          title: "间谍提名圣女:注册裁定",
          detail: `${nom.name}(间谍) 提名了圣女 ${target.name}。若间谍此刻注册为村民,提名者将被立刻处决;否则无事发生。`,
          options: [
            { label: "间谍注册为村民:提名者被处决", value: { triggers: true } },
            { label: "间谍注册为爪牙:无事发生", value: { triggers: false } }
          ],
          defaultIndex: 0,
          resume: { kind: "virgin", nominator, nominee }
        });
        return { ok: true, pendingStoryteller: true };
      }
      const triggers = this._stManual()
        ? this.roles[nom.role].team === TEAM.TOWNSFOLK
        : registrationOf(nom, this.rng, this.script).team === TEAM.TOWNSFOLK;
      if (triggers) {
        this._log(`${nom.name} 提名圣女,被立刻处决!`, "execution");
        this._execute(nom.seat);
        this._nightfall();
        return { ok: true, virginTriggered: true };
      }
    }
    if (target.role === "virgin" && !target.usedAbility) target.usedAbility = true;

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

    // 非 auto 模式:隐士被真杀手射击时,注册结果由说书人裁定
    if (isRealSlayer && victim.alive && this._stManual()) {
      if (victim.role === "recluse") {
        this._requestDecision({
          type: "slayer-shot",
          seat: player.seat,
          roleId: "slayer",
          title: "杀手射击隐士:注册裁定",
          detail: `杀手 ${player.name} 对隐士 ${victim.name} 开枪。若隐士此刻注册为恶魔,他将死亡;否则无事发生。`,
          options: [
            { label: "隐士注册为外来者:无事发生", value: { dies: false } },
            { label: "隐士误注册为恶魔:死亡", value: { dies: true } }
          ],
          defaultIndex: 0,
          resume: { kind: "slayer", target: victim.seat }
        });
        return { ok: true, pendingStoryteller: true };
      }
      if (this.roles[victim.role].team === TEAM.DEMON) {
        this._log(`${victim.name} 死亡!`, "death");
        this._kill(target, "slayer");
      } else {
        this._log("什么都没有发生……");
      }
      return { ok: true };
    }

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
   * 返回 true 表示已挂起。
   */
  _requestInfoDecision(player, roleId, corrupt, targets) {
    const s = this.state;
    const built = buildNightInfoOptions(roleId, {
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
    const resumeNight = () => {
      s.nightIndex++;
      this._advanceNight();
    };

    switch (d.resume.kind) {
      case "setup": {
        s.setupFlags = s.setupFlags || {};
        if (d.resume.step === "drunk") {
          s.players[d.seat].believedRole = opt.value.roleId;
          s.setupFlags.drunk = true;
        } else if (d.resume.step === "redHerring") {
          for (const p of s.players) p.redHerring = false;
          s.players[opt.value.seat].redHerring = true;
          s.setupFlags.redHerring = true;
        }
        if (!this._requestSetupDecision()) this._nightSetupAndQueue();
        break;
      }
      case "night-info": {
        this._tell(d.seat, opt.value.text);
        resumeNight();
        break;
      }
      case "star-pass": {
        const heir = s.players[opt.value.seat];
        if (heir && heir.alive) this._makeHeir(heir);
        this._checkWin("demon-suicide");
        if (!s.winner) resumeNight();
        break;
      }
      case "imp-kill-final": {
        this._impKillFinal(opt.value.seat);
        if (!s.winner) resumeNight();
        break;
      }
      case "virgin": {
        const { nominator, nominee } = d.resume;
        if (opt.value.triggers) {
          this._log(`${s.players[nominator].name} 提名圣女,被立刻处决!`, "execution");
          this._execute(nominator);
          if (!s.winner) this._nightfall();
        } else {
          this._beginVote(nominator, nominee);
        }
        break;
      }
      case "slayer": {
        const victim = s.players[d.resume.target];
        if (opt.value.dies && victim.alive) {
          this._log(`${victim.name} 死亡!`, "death");
          this._kill(victim.seat, "slayer");
        } else {
          this._log("什么都没有发生……");
        }
        break;
      }
      default:
        break;
    }
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
    if (s.pendingStorytellerDecision) return { ok: false, error: "请先完成待裁定事项" };
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
