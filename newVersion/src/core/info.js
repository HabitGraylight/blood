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

export { effectiveRole };