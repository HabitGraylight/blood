/**
 * 游戏设置:按剧本人数配置表抽取角色并发牌。
 * 处理设置修正、酒鬼伪装身份、占卜师红鲱鱼等脚本内规则。
 */
import { getScript, TEAM } from "../scripts/registry.js";

function resolveScript(scriptOrId) {
  return scriptOrId && scriptOrId.roles ? scriptOrId : getScript(scriptOrId);
}

function scriptRolesByTeam(script, team) {
  return Object.values(script.roles).filter((r) => r.team === team);
}

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
    .shuffle(scriptRolesByTeam(script, TEAM.MINION).map((r) => r.id))
    .slice(0, composition.minion);
  const withMod = resolveComposition(playerCount, minions, script);

  const townsfolk = rng
    .shuffle(scriptRolesByTeam(script, TEAM.TOWNSFOLK).map((r) => r.id))
    .slice(0, withMod.townsfolk);
  const outsiders = rng
    .shuffle(scriptRolesByTeam(script, TEAM.OUTSIDER).map((r) => r.id))
    .slice(0, withMod.outsider);
  const demons = rng
    .shuffle(scriptRolesByTeam(script, TEAM.DEMON).map((r) => r.id))
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
    return {
      seat,
      id: p.id,
      name: p.name,
      isHuman: !!p.isHuman,
      persona: p.persona || null,
      role: roleId,
      alignment: role.team === TEAM.MINION || role.team === TEAM.DEMON ? "evil" : "good",
      alive: true,
      ghostVote: true,
      believedRole: null,
      poisonedBy: null,
      protectedBy: null,
      master: null,
      redHerring: false,
      usedAbility: false,
      slayerUsed: false,
      diedTonight: false,
      evilInfo: null,
      privateLog: []
    };
  });

  // 酒鬼伪装:选一个不在场上的村民角色
  const drunkSeat = seats.find((s) => s.role === "drunk");
  if (drunkSeat) {
    const inPlay = new Set(seats.map((s) => s.role));
    const candidates = scriptRolesByTeam(script, TEAM.TOWNSFOLK)
      .map((r) => r.id)
      .filter((id) => !inPlay.has(id));
    drunkSeat.believedRole = rng.pick(candidates);
  }

  // 占卜师红鲱鱼:一名善良玩家永久被误判为恶魔,可包括占卜师自己
  const ftSeat = seats.find((s) => effectiveRole(s) === "fortuneteller");
  if (ftSeat) {
    const goodSeats = seats.filter((s) => s.alignment === "good");
    if (goodSeats.length) rng.pick(goodSeats).redHerring = true;
  }

  return seats;
}

/** 玩家实际按哪个角色行动/自认为的角色(酒鬼看到的是伪装身份) */
export function effectiveRole(player) {
  return player.believedRole || player.role;
}

/** 玩家真实是否拥有该角色能力(酒鬼没有任何能力) */
export function hasRealAbility(player) {
  return player.role !== "drunk";
}