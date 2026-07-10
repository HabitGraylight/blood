/**
 * 《暗流涌动》(Trouble Brewing) 角色行为模块。
 *
 * 引擎(core/engine.js)只运行通用生命周期:夜间队列、死亡管线、提名/投票/处决、
 * 说书人裁定挂起与恢复。所有角色专属逻辑都以 hook 形式写在剧本自己的行为模块里,
 * 角色 ID 字面量只允许出现在这里 —— 引擎与 core 层不出现任何具体角色。
 *
 * ==== 剧本行为契约(新增剧本按此实现) ====
 *
 * 剧本级:
 * - finalizeSetup(seats, rng, script)
 *     发牌后的设置期处理(伪装身份、红鲱鱼等)。seats 是已构造的玩家初始状态。
 * - setupSteps: [{ id, build(ctx) => decision|null, apply(ctx, decision, value) }]
 *     非 auto 模式首夜前依次征询说书人的设置裁量。build 返回 null 表示本步无需裁量;
 *     apply 在说书人选择后落地。引擎用 state.setupFlags[id] 记录进度。
 * - actions: { [actionType]: (ctx, action) => result }
 *     剧本专属的 dispatch 动作(如杀手开枪),与引擎内建动作同级。
 * - resumeHandlers: { [kind]: (ctx, decision, option) => void }
 *     角色裁量点(requestDecision 的 resume.kind)被说书人裁定后的恢复逻辑。
 *     "setup" 与 "night-info" 两种 kind 由引擎通用处理,不要占用。
 * - buildNightInfoOptions(roleId, context) => { detail, options } | null
 *     非 auto 模式下夜间信息角色的说书人候选项(见 trouble-brewing-info.js)。
 * - checkWin(players, script, defaultCheckWin) => { winner, reason } | null
 *     可选:覆盖默认胜负判定(默认为"恶魔死→善良胜;仅剩2人→邪恶胜")。
 *
 * 角色级 roles[roleId](夜间 hook 按 effectiveRole 查找,被动 hook 按真实 role 查找):
 * - queueWhenDead: bool                    死亡后仍进入夜间队列(如守鸦人)
 * - shouldWake(ctx, player) => bool        是否唤醒;缺省为 player.alive
 * - resolveNightChoice(ctx, player, targets) => paused
 *     需要选择目标的夜间能力结算;返回 true 表示挂起等待说书人裁定
 * - resolveNightInfo(ctx, player) => paused
 *     无需输入的信息类夜间能力结算
 * - immuneToDemon(ctx, player) => bool     是否免疫恶魔夜杀(如士兵)
 * - redirectDemonKill(ctx, player, { attackerSeat })
 *     被恶魔选中时的死亡转移(如镇长)。返回 { paused: true } | { abort: true } |
 *     { target: seat } | null(按原目标继续)
 * - onDeath(ctx, self, { dead, cause, aliveBeforeDeath })
 *     任何人死亡时对每名存活玩家触发(如猩红夫人变身)
 * - onNominated(ctx, nominator, self) => result|null
 *     被提名时;返回真值(dispatch 结果对象)则终止默认投票流程
 * - onExecuted(ctx, self) => bool          被处决时;返回 true 表示已处理,跳过普通死亡
 * - onDuskNoExecution(ctx, self)           黄昏无人被处决时(如镇长胜利)
 * - modifyVote(ctx, voter, currentVote) => bool  本票是否有效(如管家)
 *
 * ctx 是引擎提供的行为上下文,见 engine.js 的 _buildBehaviorContext。
 */
import { TEAM, isDayActionable } from "../core/constants.js";
import { registersAsDemon, registrationOf } from "../core/registration.js";
import {
  washerwomanInfo, librarianInfo, investigatorInfo, chefInfo, empathInfo,
  fortuneTellerInfo, undertakerInfo, ravenkeeperInfo, spyGrimoire,
  buildNightInfoCandidates
} from "./trouble-brewing-info.js";
import { effectiveRole } from "../core/setup.js";
import {
  getMasterSeat, getStatus, hasStatus, isAbilityUsed, setAbilityUsed, setBelievedRole,
  setMasterSeat, setPoisonedBy, setProtectedBy, setRedHerring
} from "../core/state.js";

function dayActionable(ctx) {
  return isDayActionable(ctx.state);
}

/** 通用信息角色 hook:auto 模式直接结算,非 auto 模式交说书人从合法候选中裁量 */
function infoRole(roleId, generate) {
  return {
    resolveNightInfo(ctx, player) {
      const corrupt = ctx.isCorrupt(player) || !ctx.actsWithTrueAbility(player);
      if (ctx.stManual()) return ctx.requestInfoDecision(player, roleId, corrupt, null);
      const info = generate(ctx, player, corrupt);
      if (info) ctx.tell(player.seat, info.text);
      return false;
    }
  };
}

/** 需要选择目标、产出私密信息的角色(占卜师/守鸦人) */
function choiceInfoRole(roleId, generate) {
  return {
    resolveNightChoice(ctx, player, targets) {
      const corrupt = ctx.isCorrupt(player) || !ctx.actsWithTrueAbility(player);
      if (ctx.stManual()) return ctx.requestInfoDecision(player, roleId, corrupt, targets);
      const info = generate(ctx, player, targets, corrupt);
      ctx.tell(player.seat, info.text);
      return false;
    }
  };
}

/** 爪牙变身为小恶魔(传位)。他此前施加的毒随身份消失。 */
function makeHeir(ctx, heir) {
  for (const p of ctx.state.players) {
    const poison = getStatus(p, "poisoned");
    if (p.poisonedBy === heir.seat || poison?.sourceSeat === heir.seat) setPoisonedBy(p, null);
  }
  heir.role = "imp";
  setBelievedRole(heir, null);
  ctx.tell(heir.seat, "小恶魔死亡,你变成了新的小恶魔!");
}

/* ---------------- 角色 hook ---------------- */

const ROLE_BEHAVIORS = {
  washerwoman: infoRole("washerwoman", (ctx, player, corrupt) =>
    washerwomanInfo(ctx.state.players, player, corrupt, ctx.rng, ctx.script)),

  librarian: infoRole("librarian", (ctx, player, corrupt) =>
    librarianInfo(ctx.state.players, player, corrupt, ctx.rng, ctx.script)),

  investigator: infoRole("investigator", (ctx, player, corrupt) =>
    investigatorInfo(ctx.state.players, player, corrupt, ctx.rng, ctx.script)),

  chef: infoRole("chef", (ctx, player, corrupt) =>
    chefInfo(ctx.state.players, player, corrupt, ctx.rng, ctx.script)),

  empath: infoRole("empath", (ctx, player, corrupt) =>
    empathInfo(ctx.state.players, player, corrupt, ctx.rng, ctx.script)),

  fortuneteller: choiceInfoRole("fortuneteller", (ctx, player, targets, corrupt) =>
    fortuneTellerInfo(ctx.state.players, player, targets, corrupt, ctx.rng, ctx.script)),

  undertaker: {
    resolveNightInfo(ctx, player) {
      // 夜晚开始前,executedToday 保存的是刚结束的白天的处决;当天无处决则无信息
      if (ctx.state.executedToday == null) return false;
      const corrupt = ctx.isCorrupt(player) || !ctx.actsWithTrueAbility(player);
      if (ctx.stManual()) return ctx.requestInfoDecision(player, "undertaker", corrupt, null);
      const info = undertakerInfo(ctx.state.players, ctx.state.executedToday, corrupt, ctx.rng, ctx.script);
      if (info) ctx.tell(player.seat, info.text);
      return false;
    }
  },

  monk: {
    resolveNightChoice(ctx, player, targets) {
      const target = ctx.state.players[targets[0]];
      if (!ctx.isCorrupt(player) && ctx.actsWithTrueAbility(player)) setProtectedBy(target, player.seat, player.role);
      ctx.tell(player.seat, `你今晚保护了 ${target.name}`, "action");
      return false;
    }
  },

  ravenkeeper: {
    queueWhenDead: true,
    // 只有当夜死亡才醒来
    shouldWake: (ctx, player) => player.diedTonight,
    ...choiceInfoRole("ravenkeeper", (ctx, player, targets, corrupt) =>
      ravenkeeperInfo(ctx.state.players, targets[0], corrupt, ctx.rng, ctx.script))
  },

  virgin: {
    onNominated(ctx, nominator, virgin) {
      // 首次被村民提名 → 提名者立刻被处决
      if (!isAbilityUsed(virgin, "virgin") && virgin.alive && !ctx.isCorrupt(virgin)) {
        setAbilityUsed(virgin, "virgin", true);
        // 非 auto 模式:间谍提名圣女时,注册结果由说书人裁定;其余角色注册无歧义
        if (ctx.stManual() && nominator.role === "spy") {
          ctx.requestDecision({
            type: "virgin-check",
            seat: virgin.seat,
            roleId: "virgin",
            title: "间谍提名圣女:注册裁定",
            detail: `${nominator.name}(间谍) 提名了圣女 ${virgin.name}。若间谍此刻注册为村民,提名者将被立刻处决;否则无事发生。`,
            options: [
              { label: "间谍注册为村民:提名者被处决", value: { triggers: true } },
              { label: "间谍注册为爪牙:无事发生", value: { triggers: false } }
            ],
            defaultIndex: 0,
            resume: { kind: "virgin", nominator: nominator.seat, nominee: virgin.seat }
          });
          return { ok: true, pendingStoryteller: true };
        }
        const triggers = ctx.stManual()
          ? ctx.roles[nominator.role].team === TEAM.TOWNSFOLK
          : registrationOf(nominator, ctx.rng, ctx.script).team === TEAM.TOWNSFOLK;
        if (triggers) {
          ctx.log(`${nominator.name} 提名圣女,被立刻处决!`, "execution");
          ctx.execute(nominator.seat);
          ctx.nightfall();
          return { ok: true, virginTriggered: true };
        }
      }
      if (!isAbilityUsed(virgin, "virgin")) setAbilityUsed(virgin, "virgin", true);
      return null; // 继续默认投票流程
    }
  },

  soldier: {
    immuneToDemon: (ctx, soldier) => !ctx.isCorrupt(soldier)
  },

  mayor: {
    /** 恶魔夜杀镇长:说书人可裁定转移;自动模式下用启发式随机转移 */
    redirectDemonKill(ctx, mayor, { attackerSeat }) {
      const s = ctx.state;
      if (ctx.isCorrupt(mayor)) return null;
      if (s.mayorRedirectSeat !== undefined) {
        if (s.mayorRedirectSeat === null) return { abort: true };
        const redirected = s.players[s.mayorRedirectSeat];
        s.mayorRedirectSeat = undefined;
        return redirected ? { target: redirected.seat } : null;
      }
      if (ctx.stManual()) {
        const others = ctx.alive().filter((p) => p.seat !== mayor.seat && p.seat !== attackerSeat);
        ctx.requestDecision({
          type: "mayor-redirect",
          seat: mayor.seat,
          roleId: "mayor",
          title: "镇长被恶魔袭击:是否转移死亡",
          detail: `恶魔选择杀死镇长 ${mayor.name}。按镇长能力,你可以让另一名玩家代替他死亡(士兵免疫与僧侣保护仍然生效)。`,
          options: [
            { label: `不转移,${mayor.name} 承受袭击`, value: { seat: mayor.seat } },
            ...others.map((p) => ({ label: `转移给 ${p.name}`, value: { seat: p.seat } }))
          ],
          defaultIndex: 0,
          resume: { kind: "imp-kill-final", impSeat: attackerSeat }
        });
        return { paused: true };
      }
      if (ctx.rng.chance(0.5)) {
        const others = ctx.alive().filter((p) => p.seat !== mayor.seat && p.seat !== attackerSeat);
        if (others.length) return { target: ctx.rng.pick(others).seat };
      }
      return null;
    },

    /** 镇长胜利:三人存活且当天无处决 */
    onDuskNoExecution(ctx, mayor) {
      if (ctx.alive().length === 3 && !ctx.isCorrupt(mayor)) {
        ctx.win("good", "只剩三名玩家存活且无人被处决,镇长带领善良阵营获胜!");
      }
    }
  },

  butler: {
    resolveNightChoice(ctx, player, targets) {
      const target = ctx.state.players[targets[0]];
      setMasterSeat(player, target.seat);
      ctx.tell(player.seat, `你选择了 ${target.name} 作为主人,明天只有他投票你才能投票`, "action");
      return false;
    },

    /** 管家:主人正在投票、已经赞成、或尚未被计票但声明赞成时,管家可投票 */
    modifyVote(ctx, voter, cv) {
      const masterSeat = getMasterSeat(voter);
      if (masterSeat == null || ctx.isCorrupt(voter)) return true;
      const masterIndex = cv.order.indexOf(masterSeat);
      const masterAlreadyVoted = cv.votes[masterSeat] === true;
      const masterIsCurrent = cv.order[cv.index] === masterSeat;
      const masterWillVoteLater = masterIndex > cv.index && cv.masterIntent === true;
      if (masterAlreadyVoted || masterIsCurrent || masterWillVoteLater) return true;
      ctx.tell(voter.seat, "你的主人没有投票,你的投票无效");
      return false;
    }
  },

  saint: {
    /** 圣徒被处决 → 邪恶获胜(清醒时) */
    onExecuted(ctx, saint) {
      if (ctx.isCorrupt(saint)) return false;
      saint.alive = false;
      ctx.win("evil", `圣徒 ${saint.name} 被处决,邪恶阵营获胜!`);
      return true;
    }
  },

  poisoner: {
    resolveNightChoice(ctx, player, targets) {
      const target = ctx.state.players[targets[0]];
      if (!ctx.isCorrupt(player) && ctx.actsWithTrueAbility(player)) setPoisonedBy(target, player.seat, player.role);
      ctx.tell(player.seat, `你对 ${target.name} 下了毒`, "action");
      return false;
    }
  },

  spy: {
    resolveNightInfo(ctx, player) {
      const corrupt = ctx.isCorrupt(player) || !ctx.actsWithTrueAbility(player);
      if (corrupt) return false;
      const info = spyGrimoire(ctx.state.players, ctx.script);
      ctx.tell(player.seat, info.text);
      return false;
    }
  },

  scarletwoman: {
    // 夜间位其实是"变身检查",在死亡结算时处理,夜里不唤醒
    shouldWake: () => false,
    /** 恶魔死亡且死亡前存活>=5 → 接任恶魔(处决/杀手场景;夜间自杀传位单独处理) */
    onDeath(ctx, sw, { dead, aliveBeforeDeath }) {
      if (ctx.roles[dead.role].team !== TEAM.DEMON) return;
      if (aliveBeforeDeath < 5) return;
      if (hasStatus(sw, "poisoned") || sw.poisonedBy != null) return;
      sw.role = "imp";
      setBelievedRole(sw, null);
      ctx.tell(sw.seat, "恶魔死亡,你变成了新的小恶魔!");
    }
  },

  imp: {
    // 小恶魔首夜不杀人(队列里不会有,防御性判断)
    shouldWake: (ctx, player) => player.alive && ctx.state.night > 1,

    /** 小恶魔杀人(含自杀传位、士兵/僧侣/镇长/猩红夫人交互) */
    resolveNightChoice(ctx, imp, targets) {
      const s = ctx.state;
      let target = s.players[targets[0]];
      ctx.tell(imp.seat, `你选择了杀死 ${target.name}`, "action");

      if (ctx.isCorrupt(imp)) return false; // 中毒的恶魔杀不死人
      if (ctx.safeFromDemon(target)) return false;

      // 自杀传位:一名存活爪牙变成小恶魔(优先猩红夫人)
      if (target.seat === imp.seat) {
        ctx.kill(imp.seat, "demon-suicide");
        const minions = ctx.alive().filter((p) => ctx.roles[p.role].team === TEAM.MINION);
        if (!minions.length) {
          ctx.checkWin("demon-suicide");
          return false;
        }
        if (ctx.stManual() && minions.length > 1) {
          const swIndex = minions.findIndex((p) => p.role === "scarletwoman" && !hasStatus(p, "poisoned") && p.poisonedBy == null);
          ctx.requestDecision({
            type: "star-pass",
            seat: imp.seat,
            roleId: "imp",
            title: "小恶魔自杀:选择传位的爪牙",
            detail: "小恶魔杀死了自己,一名存活爪牙将变成新的小恶魔。官方惯例:清醒的猩红夫人优先。",
            options: minions.map((p) => ({
              label: `${p.name}(${ctx.roleName(p.role)})${hasStatus(p, "poisoned") || p.poisonedBy != null ? "(中毒)" : ""}`,
              value: { seat: p.seat }
            })),
            defaultIndex: swIndex >= 0 ? swIndex : 0,
            resume: { kind: "star-pass" }
          });
          return true;
        }
        const heir = minions.find((p) => p.role === "scarletwoman" && !hasStatus(p, "poisoned") && p.poisonedBy == null) || ctx.rng.pick(minions);
        makeHeir(ctx, heir);
        ctx.checkWin("demon-suicide");
        return false;
      }

      // 目标角色的死亡转移(镇长替死)
      const redirect = ctx.roleHook(target.role, "redirectDemonKill");
      if (redirect) {
        const r = redirect(ctx, target, { attackerSeat: imp.seat });
        if (r) {
          if (r.paused) return true;
          if (r.abort) return false;
          if (r.target != null) target = s.players[r.target];
        }
      }

      ctx.demonKillFinal(target.seat);
      return false;
    }
  }
};

/* ---------------- 设置期(发牌后)处理 ---------------- */

/** 酒鬼伪装身份与占卜师红鲱鱼(auto 模式的随机版本;非 auto 模式可再经说书人复核) */
function finalizeSetup(seats, rng, script) {
  // 酒鬼伪装:选一个不在场上的村民角色
  const drunkSeat = seats.find((s) => s.role === "drunk");
  if (drunkSeat) {
    const inPlay = new Set(seats.map((s) => s.role));
    const candidates = Object.values(script.roles)
      .filter((r) => r.team === TEAM.TOWNSFOLK)
      .map((r) => r.id)
      .filter((id) => !inPlay.has(id));
    setBelievedRole(drunkSeat, rng.pick(candidates));
  }

  // 占卜师红鲱鱼:一名善良玩家永久被误判为恶魔,可包括占卜师自己
  const ftSeat = seats.find((s) => effectiveRole(s) === "fortuneteller");
  if (ftSeat) {
    const goodSeats = seats.filter((s) => s.alignment === "good");
    if (goodSeats.length) setRedHerring(rng.pick(goodSeats), true);
  }
}

/* ---------------- 设置期说书人裁量步骤(非 auto 模式) ---------------- */

const SETUP_STEPS = [
  {
    id: "drunk",
    build(ctx) {
      const s = ctx.state;
      const drunk = s.players.find((p) => p.role === "drunk");
      if (!drunk) return null;
      const inPlay = new Set(s.players.map((p) => p.role));
      const candidates = Object.values(ctx.roles)
        .filter((r) => r.team === TEAM.TOWNSFOLK && !inPlay.has(r.id));
      return {
        type: "setup-drunk",
        seat: drunk.seat,
        roleId: "drunk",
        title: "选择酒鬼的伪装身份",
        detail: `${drunk.name} 是酒鬼,他将自认为是一个不在场的村民角色并按其行动(但没有真实能力)。当前随机选择为【${ctx.roleName(effectiveRole(drunk))}】。`,
        options: candidates.map((r) => ({
          label: `${r.name}${r.id === effectiveRole(drunk) ? "(默认)" : ""}`,
          value: { roleId: r.id }
        })),
        defaultIndex: Math.max(0, candidates.findIndex((r) => r.id === effectiveRole(drunk)))
      };
    },
    apply(ctx, decision, value) {
      setBelievedRole(ctx.state.players[decision.seat], value.roleId);
    }
  },
  {
    id: "redHerring",
    build(ctx) {
      const s = ctx.state;
      // 酒鬼伪装可能刚被改成占卜师,此时场上尚无红鲱鱼,一并在此裁定
      const ft = s.players.find((p) => effectiveRole(p) === "fortuneteller");
      if (!ft) return null;
      const current = s.players.find((p) => hasStatus(p, "redHerring") || p.redHerring) || null;
      const goods = s.players.filter((p) => p.alignment === "good");
      return {
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
        defaultIndex: Math.max(0, goods.findIndex((p) => current && p.seat === current.seat))
      };
    },
    apply(ctx, decision, value) {
      for (const p of ctx.state.players) setRedHerring(p, false);
      setRedHerring(ctx.state.players[value.seat], true);
    }
  }
];

/* ---------------- 剧本专属 dispatch 动作 ---------------- */

const ACTIONS = {
  /** 杀手开枪(任何玩家都可以"声称"开枪,但只有真杀手有效) */
  slayerShot(ctx, { seat, target }) {
    const s = ctx.state;
    if (!dayActionable(ctx)) return { ok: false, error: "现在不能使用能力" };
    const player = s.players[seat];
    const victim = s.players[target];
    if (!player.alive) return { ok: false, error: "死亡的玩家不能使用能力" };
    if (isAbilityUsed(player, "slayer")) return { ok: false, error: "你已经用过这个能力了" };
    setAbilityUsed(player, "slayer", true);
    ctx.log(`${player.name} 声称杀手,对 ${victim.name} 开枪!`, "slayer");

    const isRealSlayer = player.role === "slayer" && !ctx.isCorrupt(player);

    // 非 auto 模式:隐士被真杀手射击时,注册结果由说书人裁定
    if (isRealSlayer && victim.alive && ctx.stManual()) {
      if (victim.role === "recluse") {
        ctx.requestDecision({
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
      if (ctx.roles[victim.role].team === TEAM.DEMON) {
        ctx.log(`${victim.name} 死亡!`, "death");
        ctx.kill(target, "slayer");
      } else {
        ctx.log("什么都没有发生……");
      }
      return { ok: true };
    }

    if (isRealSlayer && victim.alive && registersAsDemon(victim, ctx.rng, ctx.script)) {
      ctx.log(`${victim.name} 死亡!`, "death");
      ctx.kill(target, "slayer");
    } else {
      ctx.log("什么都没有发生……");
    }
    return { ok: true };
  },

  /** 说书人预先裁定镇长夜间替死目标(null = 无人替死) */
  storytellerResolveMayor(ctx, { redirectSeat }) {
    ctx.state.mayorRedirectSeat = redirectSeat == null ? null : Number(redirectSeat);
    const label = redirectSeat == null ? "无人替死" : ctx.state.players[redirectSeat]?.name || redirectSeat;
    ctx.note(`镇长夜间死亡转移裁定:${label}`, "mayor");
    return { ok: true };
  }
};

/* ---------------- 裁定恢复 handler ---------------- */

const RESUME_HANDLERS = {
  /** 小恶魔自杀传位 */
  "star-pass"(ctx, decision, opt) {
    const heir = ctx.state.players[opt.value.seat];
    if (heir && heir.alive) makeHeir(ctx, heir);
    ctx.checkWin("demon-suicide");
    if (!ctx.state.winner) ctx.resumeNight();
  },

  /** 镇长替死裁定后的最终击杀 */
  "imp-kill-final"(ctx, decision, opt) {
    ctx.demonKillFinal(opt.value.seat);
    if (!ctx.state.winner) ctx.resumeNight();
  },

  /** 间谍提名圣女的注册裁定 */
  virgin(ctx, decision, opt) {
    const { nominator, nominee } = decision.resume;
    if (opt.value.triggers) {
      ctx.log(`${ctx.state.players[nominator].name} 提名圣女,被立刻处决!`, "execution");
      ctx.execute(nominator);
      if (!ctx.state.winner) ctx.nightfall();
    } else {
      ctx.beginVote(nominator, nominee);
    }
  },

  /** 杀手射击隐士的注册裁定 */
  slayer(ctx, decision, opt) {
    const victim = ctx.state.players[decision.resume.target];
    if (opt.value.dies && victim.alive) {
      ctx.log(`${victim.name} 死亡!`, "death");
      ctx.kill(victim.seat, "slayer");
    } else {
      ctx.log("什么都没有发生……");
    }
  }
};

export const TROUBLE_BREWING_BEHAVIORS = {
  roles: ROLE_BEHAVIORS,
  finalizeSetup,
  setupSteps: SETUP_STEPS,
  actions: ACTIONS,
  resumeHandlers: RESUME_HANDLERS,
  /** 非 auto 模式下,引擎为夜间信息角色征询说书人时的候选项生成 */
  buildNightInfoOptions: buildNightInfoCandidates
};
