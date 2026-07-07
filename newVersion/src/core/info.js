/**
 * 信息生成:各获取信息类角色的真实信息与假信息(中毒/醉酒时)。
 * 同时处理间谍/隐士的"误注册"机制——由自动说书人以随机+平衡启发式裁定。
 */
import { ROLES, TEAM, rolesByTeam, roleName } from "./data/roles.js";
import { effectiveRole } from "./setup.js";

/* ---------------- 误注册 ---------------- */

/**
 * 该玩家在能力检定中"注册"为什么。
 * 间谍可能注册为善良/村民/外来者;隐士可能注册为邪恶/爪牙/恶魔。
 * 返回 { alignment, team, roleId }
 */
export function registrationOf(player, rng) {
  if (player.role === "spy" && rng.chance(0.75)) {
    const fakeRole = rng.pick(rolesByTeam(TEAM.TOWNSFOLK));
    return { alignment: "good", team: rng.chance(0.8) ? TEAM.TOWNSFOLK : TEAM.OUTSIDER, roleId: fakeRole.id };
  }
  if (player.role === "recluse" && rng.chance(0.6)) {
    const team = rng.chance(0.75) ? TEAM.MINION : TEAM.DEMON;
    const fakeRole = rng.pick(rolesByTeam(team));
    return { alignment: "evil", team, roleId: fakeRole.id };
  }
  const role = ROLES[player.role];
  return { alignment: player.alignment, team: role.team, roleId: player.role };
}

/** 检定一名玩家是否注册为恶魔(占卜师/杀手用) */
export function registersAsDemon(player, rng) {
  return registrationOf(player, rng).team === TEAM.DEMON;
}

/** 检定一名玩家是否注册为邪恶(共情者/厨师用) */
export function registersAsEvil(player, rng) {
  return registrationOf(player, rng).alignment === "evil";
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

/* ---------------- 各角色信息 ---------------- */

function pickOtherSeat(players, excludeSeats, rng) {
  const pool = players.filter((p) => !excludeSeats.includes(p.seat));
  return rng.pick(pool);
}

/**
 * 洗衣妇/图书管理员/调查员共用的"两人之一是某角色"信息。
 * team: 要指认的阵营类别; corrupt: 是否给假信息。
 */
function twoPlayerClue(players, self, team, corrupt, rng) {
  const teamLabel = { [TEAM.TOWNSFOLK]: "村民", [TEAM.OUTSIDER]: "外来者", [TEAM.MINION]: "爪牙" }[team];

  if (corrupt) {
    // 假信息:随机指认两名玩家和一个该类别角色(尽量可信)
    const a = pickOtherSeat(players, [self.seat], rng);
    const b = pickOtherSeat(players, [self.seat, a.seat], rng);
    const fakeRole = rng.pick(rolesByTeam(team));
    return {
      text: `${a.name} 和 ${b.name} 之中,有一人是【${fakeRole.name}】(${teamLabel})`,
      seats: [a.seat, b.seat],
      roleId: fakeRole.id
    };
  }

  // 真实信息:找一名该类别玩家(考虑间谍误注册为村民/外来者)
  const candidates = [];
  for (const p of players) {
    if (p.seat === self.seat) continue;
    const reg = registrationOf(p, rng);
    if (reg.team === team) candidates.push({ player: p, roleId: reg.roleId });
  }
  if (!candidates.length) {
    if (team === TEAM.OUTSIDER) return { text: "场上没有外来者", seats: [], roleId: null };
    // 理论上村民/爪牙必有;兜底
    return { text: `场上没有${teamLabel}`, seats: [], roleId: null };
  }
  const hit = rng.pick(candidates);
  const decoy = pickOtherSeat(players, [self.seat, hit.player.seat], rng);
  const pair = rng.shuffle([hit.player, decoy]);
  return {
    text: `${pair[0].name} 和 ${pair[1].name} 之中,有一人是【${roleName(hit.roleId)}】(${teamLabel})`,
    seats: [pair[0].seat, pair[1].seat],
    roleId: hit.roleId
  };
}

export function washerwomanInfo(players, self, corrupt, rng) {
  return twoPlayerClue(players, self, TEAM.TOWNSFOLK, corrupt, rng);
}

export function librarianInfo(players, self, corrupt, rng) {
  if (corrupt && rng.chance(0.25)) return { text: "场上没有外来者", seats: [], roleId: null };
  return twoPlayerClue(players, self, TEAM.OUTSIDER, corrupt, rng);
}

export function investigatorInfo(players, self, corrupt, rng) {
  return twoPlayerClue(players, self, TEAM.MINION, corrupt, rng);
}

export function chefInfo(players, self, corrupt, rng) {
  if (corrupt) {
    const fake = rng.int(3);
    return { text: `相邻的邪恶玩家有 ${fake} 对`, value: fake };
  }
  let pairs = 0;
  const n = players.length;
  const evil = players.map((p) => registersAsEvil(p, rng));
  for (let i = 0; i < n; i++) {
    if (evil[i] && evil[(i + 1) % n]) pairs++;
  }
  return { text: `相邻的邪恶玩家有 ${pairs} 对`, value: pairs };
}

export function empathInfo(players, self, corrupt, rng) {
  const neighbors = aliveNeighbors(players, self.seat);
  const names = neighbors.map((p) => p.name).join("、");
  if (corrupt) {
    const fake = rng.int(3);
    return { text: `你的存活邻座(${names})中有 ${fake} 名邪恶玩家`, value: fake };
  }
  let count = 0;
  for (const p of neighbors) if (registersAsEvil(p, rng)) count++;
  return { text: `你的存活邻座(${names})中有 ${count} 名邪恶玩家`, value: count };
}

export function fortuneTellerInfo(players, self, targetSeats, corrupt, rng) {
  const targets = targetSeats.map((s) => players[s]);
  const names = targets.map((p) => p.name).join("、");
  let yes;
  if (corrupt) {
    yes = rng.chance(0.4);
  } else {
    yes = targets.some((p) => registersAsDemon(p, rng) || p.redHerring);
  }
  return { text: `${names} 之中${yes ? "有" : "没有"}恶魔`, value: yes };
}

export function undertakerInfo(players, executedSeat, corrupt, rng) {
  const executed = players[executedSeat];
  let roleId;
  if (corrupt) {
    roleId = rng.pick(Object.keys(ROLES).filter((id) => id !== executed.role));
  } else {
    roleId = registrationOf(executed, rng).roleId;
    // 酒鬼被处决:送葬者得知"酒鬼"(官方规则)
    if (executed.role === "drunk") roleId = "drunk";
  }
  return { text: `今天被处决的 ${executed.name} 的角色是【${roleName(roleId)}】`, roleId };
}

export function ravenkeeperInfo(players, targetSeat, corrupt, rng) {
  const target = players[targetSeat];
  let roleId;
  if (corrupt) {
    roleId = rng.pick(Object.keys(ROLES).filter((id) => id !== target.role));
  } else {
    roleId = registrationOf(target, rng).roleId;
  }
  return { text: `${target.name} 的角色是【${roleName(roleId)}】`, roleId };
}

/** 间谍看魔典:完整的真实身份列表与状态 */
export function spyGrimoire(players) {
  const lines = players.map((p) => {
    const marks = [];
    if (!p.alive) marks.push("死亡");
    if (p.poisonedBy != null) marks.push("中毒");
    if (p.believedRole) marks.push(`自以为是${roleName(p.believedRole)}`);
    if (p.redHerring) marks.push("红鲱鱼");
    return `${p.name}: ${roleName(p.role)}${marks.length ? ` (${marks.join(",")})` : ""}`;
  });
  return { text: `魔典:\n${lines.join("\n")}`, entries: lines };
}

/** 首夜恶魔信息:得知爪牙 + 三个不在场角色(伪装建议) */
export function demonFirstNightInfo(players, self, rng) {
  const minions = players.filter((p) => ROLES[p.role].team === TEAM.MINION);
  const inPlay = new Set(players.map((p) => p.role));
  const bluffs = rng
    .shuffle([...rolesByTeam(TEAM.TOWNSFOLK), ...rolesByTeam(TEAM.OUTSIDER)].filter((r) => !inPlay.has(r.id) && r.id !== "drunk"))
    .slice(0, 3);
  return {
    text:
      `你的爪牙是: ${minions.map((p) => `${p.name}(${roleName(p.role)})`).join("、") || "无"}\n` +
      `不在场的角色(可用作伪装): ${bluffs.map((r) => r.name).join("、")}`,
    minionSeats: minions.map((p) => p.seat),
    bluffs: bluffs.map((r) => r.id)
  };
}

/** 首夜爪牙信息:互认 + 得知恶魔 */
export function minionFirstNightInfo(players, self) {
  const demon = players.find((p) => ROLES[p.role].team === TEAM.DEMON);
  const otherMinions = players.filter(
    (p) => p.seat !== self.seat && ROLES[p.role].team === TEAM.MINION
  );
  return {
    text:
      `恶魔是: ${demon.name}` +
      (otherMinions.length
        ? `\n其他爪牙: ${otherMinions.map((p) => `${p.name}(${roleName(p.role)})`).join("、")}`
        : ""),
    demonSeat: demon.seat,
    minionSeats: otherMinions.map((p) => p.seat)
  };
}

export { effectiveRole };
