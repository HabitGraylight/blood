/**
 * 游戏设置:按剧本人数配置表抽取角色并发牌。
 * 处理设置修正、酒鬼伪装身份、占卜师红鲱鱼等脚本内规则。
 */
import { TEAM, resolveScript, rolesByTeam } from "../scripts/registry.js";
import { normalizePlayer } from "./state.js";

/** 计算实际身份分布(应用男爵等设置修正) */
export function resolveComposition(playerCount, chosenRoles = [], scriptOrId) {
  const script = resolveScript(scriptOrId);
  const base = { ...script.setupTable[playerCount] };
  for (const roleId of chosenRoles) {
    const mod = script.roles[roleId] && script.roles[roleId].setupModifier;
    if (mod) {
      for (const [team, delta] of Object.entries(mod)) {
        base[team] = Math.max(0, (base[team] || 0) + delta);
      }
    }
  }
  return base;
}

/**
 * 抽取本局角色列表。
 * 返回 { roles: string[], composition } — roles 数量等于玩家数。
 */
export function drawRoles(playerCount, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  if (!script.setupTable[playerCount]) {
    throw new Error(`不支持的玩家数量: ${playerCount} (需要 ${script.minPlayers}-${script.maxPlayers} 人)`);
  }
  const composition = { ...script.setupTable[playerCount] };

  // 先抽爪牙:若抽到男爵,应用 +2 外来者修正
  const minions = rng
    .shuffle(rolesByTeam(script, TEAM.MINION).map((r) => r.id))
    .slice(0, composition.minion);
  const withMod = resolveComposition(playerCount, minions, script);

  const townsfolk = rng
    .shuffle(rolesByTeam(script, TEAM.TOWNSFOLK).map((r) => r.id))
    .slice(0, withMod.townsfolk);
  const outsiders = rng
    .shuffle(rolesByTeam(script, TEAM.OUTSIDER).map((r) => r.id))
    .slice(0, withMod.outsider);
  const demons = rng
    .shuffle(rolesByTeam(script, TEAM.DEMON).map((r) => r.id))
    .slice(0, withMod.demon || 1);

  return {
    roles: rng.shuffle([...townsfolk, ...outsiders, ...minions, ...demons]),
    composition: withMod
  };
}

/**
 * 将角色分配给座位,构造玩家初始状态。
 * players: [{ id, name, isHuman }] 按座位顺序。
 * fixedRoles: 测试用,按座位顺序直接指定角色,跳过随机抽取。
 */
export function assignRoles(players, rng, fixedRoles, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const roles = fixedRoles || drawRoles(players.length, rng, script).roles;

  const seats = players.map((p, seat) => {
    const roleId = roles[seat];
    const role = script.roles[roleId];
    // normalizePlayer 负责初始化 roleState/statuses 与兼容旧存档的镜像字段
    return normalizePlayer({
      seat,
      id: p.id,
      name: p.name,
      isHuman: !!p.isHuman,
      avatar: p.avatar || null,
      persona: p.persona || null,
      role: roleId,
      alignment: role.team === TEAM.MINION || role.team === TEAM.DEMON ? "evil" : "good",
      alive: true,
      ghostVote: true,
      diedTonight: false,
      evilInfo: null,
      privateLog: []
    });
  });

  // 剧本的设置期处理(如酒鬼伪装身份、占卜师红鲱鱼)
  if (script.behaviors && typeof script.behaviors.finalizeSetup === "function") {
    script.behaviors.finalizeSetup(seats, rng, script);
  }

  return seats;
}

/** 玩家实际按哪个角色行动/自认为的角色(酒鬼看到的是伪装身份) */
export function effectiveRole(player) {
  return player.believedRole || player.role;
}

/** 玩家真实是否拥有该角色能力(角色定义 noAbility: true 表示没有,如酒鬼) */
export function hasRealAbility(player, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const def = script.roles[player.role];
  return !(def && def.noAbility);
}