/**
 * 信息生成:各获取信息类角色的真实信息与假信息(中毒/醉酒时)。
 * 同时处理间谍/隐士的"误注册"机制。
 */
import { getScript, TEAM } from "../scripts/registry.js";
import { effectiveRole } from "./setup.js";

function resolveScript(scriptOrId) {
  return scriptOrId && scriptOrId.roles ? scriptOrId : getScript(scriptOrId);
}

function rolesByTeam(script, team) {
  return Object.values(script.roles).filter((r) => r.team === team);
}

function roleName(script, roleId) {
  return script.roles[roleId] ? script.roles[roleId].name : roleId;
}

/* ---------------- 误注册 ---------------- */

export function registrationOf(player, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  if (player.role === "spy" && rng.chance(0.75)) {
    const fakeRole = rng.pick(rolesByTeam(script, TEAM.TOWNSFOLK));
    return { alignment: "good", team: rng.chance(0.8) ? TEAM.TOWNSFOLK : TEAM.OUTSIDER, roleId: fakeRole.id };
  }
  if (player.role === "recluse" && rng.chance(0.6)) {
    const team = rng.chance(0.75) ? TEAM.MINION : TEAM.DEMON;
    const fakeRole = rng.pick(rolesByTeam(script, team));
    return { alignment: "evil", team, roleId: fakeRole.id };
  }
  const role = script.roles[player.role];
  return { alignment: player.alignment, team: role.team, roleId: player.role };
}

export function registersAsDemon(player, rng, scriptOrId) {
  return registrationOf(player, rng, scriptOrId).team === TEAM.DEMON;
}

export function registersAsEvil(player, rng, scriptOrId) {
  return registrationOf(player, rng, scriptOrId).alignment === "evil";
}

/* ---------------- 邻座工具 ---------------- */

export function aliveNeighbors(players, seat) {
  const n = players.length;
  const findNext = (dir) => {
    for (let step = 1; step < n; step++) {
      const p = players[(seat + dir * step + n) % n];
      if (p.alive) return p;
    }
    return null;
  };
  const left = findNext(-1);
  const right = findNext(1);
  if (!left || !right || left.seat === seat) return [];
  if (left.seat === right.seat) return [left];
  return [left, right];
}

function pickOtherSeat(players, excludeSeats, rng) {
  const pool = players.filter((p) => !excludeSeats.includes(p.seat));
  return rng.pick(pool);
}

function twoPlayerClue(players, self, team, corrupt, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const teamLabel = { [TEAM.TOWNSFOLK]: "村民", [TEAM.OUTSIDER]: "外来者", [TEAM.MINION]: "爪牙" }[team];

  if (corrupt) {
    const a = pickOtherSeat(players, [self.seat], rng);
    const b = pickOtherSeat(players, [self.seat, a.seat], rng);
    const fakeRole = rng.pick(rolesByTeam(script, team));
    return {
      text: `${a.name} 和 ${b.name} 之中,有一人是【${fakeRole.name}】(${teamLabel})`,
      seats: [a.seat, b.seat],
      roleId: fakeRole.id
    };
  }

  const candidates = [];
  for (const p of players) {
    if (p.seat === self.seat) continue;
    const reg = registrationOf(p, rng, script);
    if (reg.team === team) candidates.push({ player: p, roleId: reg.roleId });
  }
  if (!candidates.length) {
    if (team === TEAM.OUTSIDER) return { text: "场上没有外来者", seats: [], roleId: null };
    return { text: `场上没有${teamLabel}`, seats: [], roleId: null };
  }
  const hit = rng.pick(candidates);
  const decoy = pickOtherSeat(players, [self.seat, hit.player.seat], rng);
  const pair = rng.shuffle([hit.player, decoy]);
  return {
    text: `${pair[0].name} 和 ${pair[1].name} 之中,有一人是【${roleName(script, hit.roleId)}】(${teamLabel})`,
    seats: [pair[0].seat, pair[1].seat],
    roleId: hit.roleId
  };
}

export function washerwomanInfo(players, self, corrupt, rng, scriptOrId) {
  return twoPlayerClue(players, self, TEAM.TOWNSFOLK, corrupt, rng, scriptOrId);
}

export function librarianInfo(players, self, corrupt, rng, scriptOrId) {
  if (corrupt && rng.chance(0.25)) return { text: "场上没有外来者", seats: [], roleId: null };
  return twoPlayerClue(players, self, TEAM.OUTSIDER, corrupt, rng, scriptOrId);
}

export function investigatorInfo(players, self, corrupt, rng, scriptOrId) {
  return twoPlayerClue(players, self, TEAM.MINION, corrupt, rng, scriptOrId);
}

export function chefInfo(players, self, corrupt, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  if (corrupt) {
    const fake = rng.int(3);
    return { text: `相邻的邪恶玩家有 ${fake} 对`, value: fake };
  }
  let pairs = 0;
  const n = players.length;
  const evil = players.map((p) => registersAsEvil(p, rng, script));
  for (let i = 0; i < n; i++) {
    if (evil[i] && evil[(i + 1) % n]) pairs++;
  }
  return { text: `相邻的邪恶玩家有 ${pairs} 对`, value: pairs };
}

export function empathInfo(players, self, corrupt, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const neighbors = aliveNeighbors(players, self.seat);
  const names = neighbors.map((p) => p.name).join("、");
  if (corrupt) {
    const fake = rng.int(3);
    return { text: `你的存活邻座(${names})中有 ${fake} 名邪恶玩家`, value: fake };
  }
  let count = 0;
  for (const p of neighbors) if (registersAsEvil(p, rng, script)) count++;
  return { text: `你的存活邻座(${names})中有 ${count} 名邪恶玩家`, value: count };
}

export function fortuneTellerInfo(players, self, targetSeats, corrupt, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const targets = targetSeats.map((s) => players[s]);
  const names = targets.map((p) => p.name).join("、");
  let yes;
  if (corrupt) {
    yes = rng.chance(0.4);
  } else {
    yes = targets.some((p) => registersAsDemon(p, rng, script) || p.redHerring);
  }
  return { text: `${names} 之中${yes ? "有" : "没有"}恶魔`, value: yes };
}

export function undertakerInfo(players, executedSeat, corrupt, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const executed = players[executedSeat];
  let roleId;
  if (corrupt) {
    roleId = rng.pick(Object.keys(script.roles).filter((id) => id !== executed.role));
  } else {
    roleId = registrationOf(executed, rng, script).roleId;
    if (executed.role === "drunk") roleId = "drunk";
  }
  return { text: `今天被处决的 ${executed.name} 的角色是【${roleName(script, roleId)}】`, roleId };
}

export function ravenkeeperInfo(players, targetSeat, corrupt, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const target = players[targetSeat];
  let roleId;
  if (corrupt) {
    roleId = rng.pick(Object.keys(script.roles).filter((id) => id !== target.role));
  } else {
    roleId = registrationOf(target, rng, script).roleId;
  }
  return { text: `${target.name} 的角色是【${roleName(script, roleId)}】`, roleId };
}

export function spyGrimoire(players, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const lines = players.map((p) => {
    const marks = [];
    if (!p.alive) marks.push("死亡");
    if (p.poisonedBy != null) marks.push("中毒");
    if (p.protectedBy != null) marks.push("被保护");
    if (p.believedRole) marks.push(`自以为是${roleName(script, p.believedRole)}`);
    if (p.redHerring) marks.push("红鲱鱼");
    return `${p.name}: ${roleName(script, p.role)}${marks.length ? ` (${marks.join(",")})` : ""}`;
  });
  return { text: `魔典:\n${lines.join("\n")}`, entries: lines };
}

export function demonFirstNightInfo(players, self, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const minions = players.filter((p) => script.roles[p.role].team === TEAM.MINION);
  const inPlay = new Set(players.map((p) => p.role));
  const bluffs = rng
    .shuffle([...rolesByTeam(script, TEAM.TOWNSFOLK), ...rolesByTeam(script, TEAM.OUTSIDER)].filter((r) => !inPlay.has(r.id) && r.id !== "drunk"))
    .slice(0, 3);
  return {
    text:
      `你的爪牙是: ${minions.map((p) => `${p.name}(${roleName(script, p.role)})`).join("、") || "无"}\n` +
      `不在场的角色(可用作伪装): ${bluffs.map((r) => r.name).join("、")}`,
    minionSeats: minions.map((p) => p.seat),
    bluffs: bluffs.map((r) => r.id)
  };
}

export function minionFirstNightInfo(players, self, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const demon = players.find((p) => script.roles[p.role].team === TEAM.DEMON);
  const otherMinions = players.filter(
    (p) => p.seat !== self.seat && script.roles[p.role].team === TEAM.MINION
  );
  return {
    text:
      `恶魔是: ${demon.name}` +
      (otherMinions.length
        ? `\n其他爪牙: ${otherMinions.map((p) => `${p.name}(${roleName(script, p.role)})`).join("、")}`
        : ""),
    demonSeat: demon.seat,
    minionSeats: otherMinions.map((p) => p.seat)
  };
}

/* ---------------- 说书人裁量:候选项生成 ----------------
 * 非 auto 模式下,引擎在裁量点暂停并向说书人(人类或 AI)征询。
 * 这里为每个信息事件生成"合法且各有战略倾向"的候选文本,
 * 说书人只能从候选中选择,不能自由改写状态。
 * 所有函数返回 { detail, options: [{ label, tag, text }] } 或 null(无裁量空间)。
 */

/** 间谍/隐士存在注册歧义 */
function isFlexible(player) {
  return player.role === "spy" || player.role === "recluse";
}

/** 玩家在某注册组合下是否算邪恶(mis=true 表示误注册) */
function evilUnder(player, mis) {
  if (player.role === "spy") return !mis; // 间谍误注册 → 善良
  if (player.role === "recluse") return mis; // 隐士误注册 → 邪恶
  return player.alignment === "evil";
}

/** 枚举一组歧义玩家的注册组合,收集统计值 */
function enumerateFlexCombos(flexSeats, evaluate) {
  const values = new Set();
  const combos = 1 << flexSeats.length;
  for (let mask = 0; mask < combos; mask++) {
    const misOf = (seat) => {
      const idx = flexSeats.indexOf(seat);
      return idx >= 0 && ((mask >> idx) & 1) === 1;
    };
    values.add(evaluate(misOf));
  }
  return [...values].sort((a, b) => a - b);
}

function chefInfoOptions(players, corrupt) {
  const mk = (v, tag) => ({ label: `告知 ${v} 对`, tag, text: `相邻的邪恶玩家有 ${v} 对` });
  if (corrupt) {
    return {
      detail: "厨师能力失效,可以告知任意数字。",
      options: [0, 1, 2].map((v) => mk(v, v === 0 ? "无害假信息" : "误导假信息"))
    };
  }
  const flex = players.filter(isFlexible).map((p) => p.seat);
  const values = enumerateFlexCombos(flex, (misOf) => {
    let pairs = 0;
    const n = players.length;
    for (let i = 0; i < n; i++) {
      const a = players[i], b = players[(i + 1) % n];
      if (evilUnder(a, misOf(a.seat)) && evilUnder(b, misOf(b.seat))) pairs++;
    }
    return pairs;
  });
  return {
    detail: flex.length ? "间谍/隐士的注册方式影响结果,以下均为合法值。" : "无注册歧义,结果唯一。",
    options: values.map((v, i) => mk(v, i === 0 && !flex.length ? "真实" : "合法"))
  };
}

function empathInfoOptions(players, self, corrupt) {
  const neighbors = aliveNeighbors(players, self.seat);
  const names = neighbors.map((p) => p.name).join("、");
  const mk = (v, tag) => ({ label: `告知 ${v} 名`, tag, text: `你的存活邻座(${names})中有 ${v} 名邪恶玩家` });
  if (corrupt) {
    return {
      detail: "共情者能力失效,可以告知任意数字。",
      options: Array.from({ length: neighbors.length + 1 }, (_, v) => mk(v, v === 0 ? "无害假信息" : "误导假信息"))
    };
  }
  const flex = neighbors.filter(isFlexible).map((p) => p.seat);
  const values = enumerateFlexCombos(flex, (misOf) =>
    neighbors.filter((p) => evilUnder(p, misOf(p.seat))).length
  );
  return {
    detail: flex.length ? "邻座中的间谍/隐士注册方式影响结果。" : "无注册歧义,结果唯一。",
    options: values.map((v) => mk(v, flex.length ? "合法" : "真实"))
  };
}

function fortuneTellerInfoOptions(players, targetSeats, corrupt, scriptOrId) {
  const script = resolveScript(scriptOrId);
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
    (p) => script.roles[p.role].team === TEAM.DEMON || p.redHerring
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

function twoPlayerClueOptions(players, self, team, corrupt, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
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
function roleRevealOptions(players, targetSeat, corrupt, rng, scriptOrId, formatText) {
  const script = resolveScript(scriptOrId);
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
 * 为夜间信息事件生成说书人候选项。
 * 返回 { detail, options } — options 长度为 1 表示无裁量空间,引擎直接结算。
 * 返回 null 表示该角色不产生可裁量信息(如间谍看魔典)。
 */
export function buildNightInfoOptions(roleId, { players, self, targets, executedSeat, corrupt, rng, script }) {
  switch (roleId) {
    case "washerwoman":
      return twoPlayerClueOptions(players, self, TEAM.TOWNSFOLK, corrupt, rng, script);
    case "librarian":
      return twoPlayerClueOptions(players, self, TEAM.OUTSIDER, corrupt, rng, script);
    case "investigator":
      return twoPlayerClueOptions(players, self, TEAM.MINION, corrupt, rng, script);
    case "chef":
      return chefInfoOptions(players, corrupt);
    case "empath":
      return empathInfoOptions(players, self, corrupt);
    case "fortuneteller":
      return fortuneTellerInfoOptions(players, targets, corrupt, script);
    case "undertaker": {
      if (executedSeat == null) return null;
      const executed = players[executedSeat];
      return roleRevealOptions(players, executedSeat, corrupt, rng, script,
        (name) => `今天被处决的 ${executed.name} 的角色是【${name}】`);
    }
    case "ravenkeeper": {
      const target = players[targets[0]];
      return roleRevealOptions(players, targets[0], corrupt, rng, script,
        (name) => `${target.name} 的角色是【${name}】`);
    }
    default:
      return null;
  }
}

export { effectiveRole };