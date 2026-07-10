/**
 * 《暗流涌动》信息生成模块。
 * 各获取信息类角色的真实信息与假信息(中毒/醉酒时),
 * 以及非 auto 模式下供说书人裁量的候选项生成。
 *
 * 本模块属于剧本层:角色 ID 字面量只允许出现在剧本目录内。
 * 通用工具(邻座查找、误注册、组合枚举)来自 core。
 */
import { TEAM } from "../core/constants.js";
import { aliveNeighbors } from "../core/info.js";
import {
  registrationOf, isFlexible, evilUnder, enumerateFlexCombos
} from "../core/registration.js";
import { hasStatus } from "../core/state.js";
import { SCRIPT as TB_SCRIPT } from "./trouble-brewing.js";

function resolveTB(scriptOrId) {
  return scriptOrId && scriptOrId.roles ? scriptOrId : TB_SCRIPT;
}

function rolesByTeam(script, team) {
  return Object.values(script.roles).filter((r) => r.team === team);
}

function roleName(script, roleId) {
  return script.roles[roleId] ? script.roles[roleId].name : roleId;
}

function pickOtherSeat(players, excludeSeats, rng) {
  const pool = players.filter((p) => !excludeSeats.includes(p.seat));
  return rng.pick(pool);
}

function pickNightInfoCandidate(roleId, context) {
  const built = buildNightInfoCandidates(roleId, context);
  if (!built || !built.options.length) return null;
  const weighted = built.options.filter((o) => o.weight && o.weight > 0);
  if (!weighted.length) return context.rng.pick(built.options);
  const total = weighted.reduce((sum, option) => sum + option.weight, 0);
  let roll = context.rng.next() * total;
  for (const option of weighted) {
    roll -= option.weight;
    if (roll <= 0) return option;
  }
  return weighted[weighted.length - 1];
}

export function washerwomanInfo(players, self, corrupt, rng, scriptOrId) {
  return pickNightInfoCandidate("washerwoman", { players, self, corrupt, rng, script: resolveTB(scriptOrId) });
}

export function librarianInfo(players, self, corrupt, rng, scriptOrId) {
  return pickNightInfoCandidate("librarian", { players, self, corrupt, rng, script: resolveTB(scriptOrId) });
}

export function investigatorInfo(players, self, corrupt, rng, scriptOrId) {
  return pickNightInfoCandidate("investigator", { players, self, corrupt, rng, script: resolveTB(scriptOrId) });
}

export function chefInfo(players, self, corrupt, rng, scriptOrId) {
  return pickNightInfoCandidate("chef", { players, self, corrupt, rng, script: resolveTB(scriptOrId) });
}

export function empathInfo(players, self, corrupt, rng, scriptOrId) {
  return pickNightInfoCandidate("empath", { players, self, corrupt, rng, script: resolveTB(scriptOrId) });
}

export function fortuneTellerInfo(players, self, targetSeats, corrupt, rng, scriptOrId) {
  return pickNightInfoCandidate("fortuneteller", { players, self, targets: targetSeats, corrupt, rng, script: resolveTB(scriptOrId) });
}

export function undertakerInfo(players, executedSeat, corrupt, rng, scriptOrId) {
  return pickNightInfoCandidate("undertaker", { players, self: players[executedSeat], executedSeat, corrupt, rng, script: resolveTB(scriptOrId) });
}

export function ravenkeeperInfo(players, targetSeat, corrupt, rng, scriptOrId) {
  return pickNightInfoCandidate("ravenkeeper", { players, self: null, targets: [targetSeat], corrupt, rng, script: resolveTB(scriptOrId) });
}

export function spyGrimoire(players, scriptOrId) {
  const script = resolveTB(scriptOrId);
  const lines = players.map((p) => {
    const marks = [];
    if (!p.alive) marks.push("死亡");
    if (hasStatus(p, "poisoned") || p.poisonedBy != null) marks.push("中毒");
    if (hasStatus(p, "protectedFromDemon") || p.protectedBy != null) marks.push("被保护");
    if (p.believedRole) marks.push(`自以为是${roleName(script, p.believedRole)}`);
    if (hasStatus(p, "redHerring") || p.redHerring) marks.push("红鲱鱼");
    return `${p.name}: ${roleName(script, p.role)}${marks.length ? ` (${marks.join(",")})` : ""}`;
  });
  return { text: `魔典:\n${lines.join("\n")}`, entries: lines };
}

/* ---------------- 说书人裁量:候选项生成 ----------------
 * 非 auto 模式下,引擎在裁量点暂停并向说书人(人类或 AI)征询。
 * 这里为每个信息事件生成"合法且各有战略倾向"的候选文本,
 * 说书人只能从候选中选择,不能自由改写状态。
 * 所有函数返回 { detail, options: [{ label, tag, text }] } 或 null(无裁量空间)。
 */

function chefInfoOptions(players, corrupt, script) {
  const mk = (v, tag) => ({ label: `告知 ${v} 对`, tag, text: `相邻的邪恶玩家有 ${v} 对` });
  if (corrupt) {
    return {
      detail: "厨师能力失效,可以告知任意数字。",
      options: [0, 1, 2].map((v) => mk(v, v === 0 ? "无害假信息" : "误导假信息"))
    };
  }
  const flex = players.filter((p) => isFlexible(p, script)).map((p) => p.seat);
  const values = enumerateFlexCombos(flex, (misOf) => {
    let pairs = 0;
    const n = players.length;
    for (let i = 0; i < n; i++) {
      const a = players[i], b = players[(i + 1) % n];
      if (evilUnder(a, misOf(a.seat), script) && evilUnder(b, misOf(b.seat), script)) pairs++;
    }
    return pairs;
  });
  return {
    detail: flex.length ? "间谍/隐士的注册方式影响结果,以下均为合法值。" : "无注册歧义,结果唯一。",
    options: values.map((v, i) => mk(v, i === 0 && !flex.length ? "真实" : "合法"))
  };
}

function empathInfoOptions(players, self, corrupt, script) {
  const neighbors = aliveNeighbors(players, self.seat);
  const names = neighbors.map((p) => p.name).join("、");
  const mk = (v, tag) => ({ label: `告知 ${v} 名`, tag, text: `你的存活邻座(${names})中有 ${v} 名邪恶玩家` });
  if (corrupt) {
    return {
      detail: "共情者能力失效,可以告知任意数字。",
      options: Array.from({ length: neighbors.length + 1 }, (_, v) => mk(v, v === 0 ? "无害假信息" : "误导假信息"))
    };
  }
  const flex = neighbors.filter((p) => isFlexible(p, script)).map((p) => p.seat);
  const values = enumerateFlexCombos(flex, (misOf) =>
    neighbors.filter((p) => evilUnder(p, misOf(p.seat), script)).length
  );
  return {
    detail: flex.length ? "邻座中的间谍/隐士注册方式影响结果。" : "无注册歧义,结果唯一。",
    options: values.map((v) => mk(v, flex.length ? "合法" : "真实"))
  };
}

function fortuneTellerInfoOptions(players, targetSeats, corrupt, script) {
  const targets = targetSeats.map((s) => players[s]);
  const names = targets.map((p) => p.name).join("、");
  const mk = (yes, tag) => ({
    label: yes ? "告知【有】恶魔" : "告知【没有】恶魔",
    tag,
    text: `${names} 之中${yes ? "有" : "没有"}恶魔`
  });
  if (corrupt) {
    return { detail: "占卜师能力失效,是/否均可。", options: [mk(false, "假信息"), mk(true, "假信息")] };
  }
  const certainYes = targets.some(
    (p) => script.roles[p.role].team === TEAM.DEMON || hasStatus(p, "redHerring") || p.redHerring
  );
  if (certainYes) return { detail: "目标中确有恶魔(或红鲱鱼),结果唯一。", options: [mk(true, "真实")] };
  if (targets.some((p) => p.role === "recluse")) {
    return {
      detail: "目标中有隐士,可注册为恶魔。",
      options: [mk(false, "隐士按真实注册"), mk(true, "隐士误注册为恶魔")]
    };
  }
  return { detail: "结果唯一。", options: [mk(false, "真实")] };
}

function twoPlayerClueOptions(players, self, team, corrupt, rng, script) {
  const teamLabel = { [TEAM.TOWNSFOLK]: "村民", [TEAM.OUTSIDER]: "外来者", [TEAM.MINION]: "爪牙" }[team];
  const pairText = (a, b, rid) => {
    const pair = rng.shuffle([a, b]);
    return `${pair[0].name} 和 ${pair[1].name} 之中,有一人是【${roleName(script, rid)}】(${teamLabel})`;
  };
  const others = players.filter((p) => p.seat !== self.seat);
  const pool = rolesByTeam(script, team).filter((r) => !r.hidden || team !== TEAM.TOWNSFOLK);

  if (corrupt) {
    const evils = others.filter((p) => p.alignment === "evil");
    const goods = others.filter((p) => p.alignment === "good");
    const options = [];
    if (evils.length && others.length >= 2) {
      const e = rng.pick(evils);
      const d = rng.pick(others.filter((p) => p.seat !== e.seat));
      options.push({ label: `指向 ${e.name}`, tag: "掩护邪恶", text: pairText(e, d, rng.pick(pool).id) });
    }
    if (goods.length >= 2) {
      const a = rng.pick(goods);
      const b = rng.pick(goods.filter((p) => p.seat !== a.seat));
      const tag = team === TEAM.MINION ? "陷害善良" : "无害假信息";
      options.push({ label: `指向 ${a.name}/${b.name}`, tag, text: pairText(a, b, rng.pick(pool).id) });
    }
    if (team === TEAM.OUTSIDER) {
      options.push({ label: "告知没有外来者", tag: "假信息", text: "场上没有外来者" });
    }
    if (!options.length) {
      const a = rng.pick(others);
      const b = rng.pick(others.filter((p) => p.seat !== a.seat));
      options.push({ label: "随机假信息", tag: "假信息", text: pairText(a, b, rng.pick(pool).id) });
    }
    return { detail: "该玩家能力失效,信息可以是任意内容。", options };
  }

  // 清醒:枚举真实候选(含间谍/隐士误注册的合法可能)
  const candidates = [];
  for (const p of others) {
    const role = script.roles[p.role];
    if (role.team === team && p.role !== "spy") candidates.push({ player: p, roleId: p.role, tag: "真实" });
    if (p.role === "spy" && (team === TEAM.TOWNSFOLK || team === TEAM.OUTSIDER)) {
      candidates.push({ player: p, roleId: rng.pick(pool).id, tag: "间谍误注册" });
    }
    if (p.role === "recluse" && team === TEAM.MINION) {
      candidates.push({ player: p, roleId: rng.pick(pool).id, tag: "隐士误注册" });
    }
  }
  if (!candidates.length) {
    // 兜底:即使场上没有真实候选(其他玩家全非此类角色),洗婆娘/图书管理员/调查员
    // 仍应获得有效线索。规则允许"误注册":说书人可以让任意玩家被注册为 pool 中任一角色
    // (本质和间谍/隐士误注册相同),信息形式仍是"2 名玩家 + 1 个具体角色名"
    if (others.length >= 2 && pool.length > 0) {
      const fakeRole = rng.pick(pool);
      const a = rng.pick(others);
      const b = rng.pick(others.filter((p) => p.seat !== a.seat));
      return {
        detail: "场上没有真实候选,使用强制虚构信息(规则允许:任意玩家可被误注册为该阵营角色)。",
        options: [{
          label: `${a.name} 是【${roleName(script, fakeRole.id)}】`,
          tag: "强制虚构",
          text: pairText(a, b, fakeRole.id)
        }]
      };
    }
    return { detail: "场上没有该类角色。", options: [{ label: "告知没有该类角色", tag: "真实", text: `场上没有${teamLabel}` }] };
  }
  const shown = rng.shuffle(candidates).slice(0, 4);
  return {
    detail: "从合法候选中选择展示给玩家的组合。",
    options: shown.map((c) => {
      const decoy = pickOtherSeat(players, [self.seat, c.player.seat], rng);
      return {
        label: `${c.player.name} 是【${roleName(script, c.roleId)}】`,
        tag: c.tag,
        text: pairText(c.player, decoy, c.roleId)
      };
    })
  };
}

/** 送葬者/守鸦人:角色揭示的合法候选 */
function roleRevealOptions(players, targetSeat, corrupt, rng, script, formatText) {
  const target = players[targetSeat];
  const mk = (rid, tag) => ({ label: `告知【${roleName(script, rid)}】`, tag, text: formatText(roleName(script, rid)) });
  if (corrupt) {
    const options = [mk(target.role, "真实(失效时也可给真信息)")];
    const inPlay = new Set(players.map((p) => p.role));
    const notInPlay = Object.keys(script.roles).filter((id) => !inPlay.has(id) && id !== target.role && !script.roles[id].hidden);
    if (notInPlay.length) options.push(mk(rng.pick(notInPlay), "不在场角色"));
    const inPlayOther = [...inPlay].filter((id) => id !== target.role);
    if (inPlayOther.length) options.push(mk(rng.pick(inPlayOther), "在场其他角色"));
    if (target.role !== "imp") options.push(mk("imp", "指认为恶魔"));
    return { detail: "该玩家能力失效,可告知任意角色。", options };
  }
  if (target.role === "spy") {
    return {
      detail: "间谍可注册为村民或外来者。",
      options: [
        mk("spy", "真实"),
        mk(rng.pick(rolesByTeam(script, TEAM.TOWNSFOLK)).id, "误注册为村民"),
        mk(rng.pick(rolesByTeam(script, TEAM.OUTSIDER).filter((r) => !r.hidden)).id, "误注册为外来者")
      ]
    };
  }
  if (target.role === "recluse") {
    return {
      detail: "隐士可注册为爪牙或恶魔。",
      options: [
        mk("recluse", "真实"),
        mk(rng.pick(rolesByTeam(script, TEAM.MINION)).id, "误注册为爪牙"),
        mk("imp", "误注册为恶魔")
      ]
    };
  }
  return { detail: "结果唯一。", options: [mk(target.role, "真实")] };
}

/**
 * 为夜间信息事件生成说书人候选项(引擎通过 behaviors.buildNightInfoOptions 调用)。
 * 返回 { detail, options } — options 长度为 1 表示无裁量空间,引擎直接结算。
 * 返回 null 表示该角色不产生可裁量信息(如间谍看魔典)。
 */
export function buildNightInfoCandidates(roleId, { players, self, targets, executedSeat, corrupt, rng, script }) {
  const tb = resolveTB(script);
  switch (roleId) {
    case "washerwoman":
      return twoPlayerClueOptions(players, self, TEAM.TOWNSFOLK, corrupt, rng, tb);
    case "librarian":
      return twoPlayerClueOptions(players, self, TEAM.OUTSIDER, corrupt, rng, tb);
    case "investigator":
      return twoPlayerClueOptions(players, self, TEAM.MINION, corrupt, rng, tb);
    case "chef":
      return chefInfoOptions(players, corrupt, tb);
    case "empath":
      return empathInfoOptions(players, self, corrupt, tb);
    case "fortuneteller":
      return fortuneTellerInfoOptions(players, targets, corrupt, tb);
    case "undertaker": {
      if (executedSeat == null) return null;
      const executed = players[executedSeat];
      return roleRevealOptions(players, executedSeat, corrupt, rng, tb,
        (name) => `今天被处决的 ${executed.name} 的角色是【${name}】`);
    }
    case "ravenkeeper": {
      const target = players[targets[0]];
      return roleRevealOptions(players, targets[0], corrupt, rng, tb,
        (name) => `${target.name} 的角色是【${name}】`);
    }
    default:
      return null;
  }
}
