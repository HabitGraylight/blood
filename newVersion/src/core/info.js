/**
 * 通用信息工具:邻座查找与首夜邪恶阵营互认。
 * 具体角色的信息生成属于各剧本(如 scripts/trouble-brewing-info.js);
 * 误注册机制见 core/registration.js。
 */
import { TEAM, resolveScript, rolesByTeam, roleName } from "../scripts/registry.js";

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

/* ---------------- 首夜邪恶阵营互认(通用 BotC 规则,7人及以上) ---------------- */

export function demonFirstNightInfo(players, self, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const minions = players.filter((p) => script.roles[p.role].team === TEAM.MINION);
  const inPlay = new Set(players.map((p) => p.role));
  // hidden 角色(如酒鬼)不能用作伪装:玩家自己都不知道自己是它
  const bluffs = rng
    .shuffle([...rolesByTeam(script, TEAM.TOWNSFOLK), ...rolesByTeam(script, TEAM.OUTSIDER)].filter((r) => !inPlay.has(r.id) && !r.hidden))
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
