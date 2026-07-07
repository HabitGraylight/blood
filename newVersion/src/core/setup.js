/**
 * 游戏设置:按人数配置表抽取角色并发牌。
 * 处理男爵的设置修正、酒鬼的伪装身份、占卜师的红鲱鱼。
 */
import { ROLES, SETUP_TABLE, TEAM, rolesByTeam } from "./data/roles.js";

/** 计算实际身份分布(应用男爵等设置修正) */
export function resolveComposition(playerCount, chosenRoles) {
  const base = { ...SETUP_TABLE[playerCount] };
  for (const roleId of chosenRoles) {
    const mod = ROLES[roleId] && ROLES[roleId].setupModifier;
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
export function drawRoles(playerCount, rng) {
  if (!SETUP_TABLE[playerCount]) {
    throw new Error(`不支持的玩家数量: ${playerCount} (需要 5-15 人)`);
  }
  const composition = { ...SETUP_TABLE[playerCount] };

  // 先抽爪牙:若抽到男爵,应用 +2 外来者修正
  const minions = rng
    .shuffle(rolesByTeam(TEAM.MINION).map((r) => r.id))
    .slice(0, composition.minion);
  const withMod = resolveComposition(playerCount, minions);

  const townsfolk = rng
    .shuffle(rolesByTeam(TEAM.TOWNSFOLK).map((r) => r.id))
    .slice(0, withMod.townsfolk);
  const outsiders = rng
    .shuffle(rolesByTeam(TEAM.OUTSIDER).map((r) => r.id))
    .slice(0, withMod.outsider);
  const demons = ["imp"];

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
export function assignRoles(players, rng, fixedRoles) {
  const roles = fixedRoles || drawRoles(players.length, rng).roles;

  const seats = players.map((p, seat) => {
    const roleId = roles[seat];
    const role = ROLES[roleId];
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
      // 酒鬼:以为自己是一个不在场上的村民角色
      believedRole: null,
      // 状态标记
      poisonedBy: null,
      protectedBy: null,
      master: null, // 管家的主人座位号
      redHerring: false, // 占卜师的红鲱鱼
      usedAbility: false, // 杀手/圣女等一次性能力
      diedTonight: false,
      evilInfo: null, // 首夜邪恶互认信息
      privateLog: []
    };
  });

  // 酒鬼伪装:选一个不在场上的村民角色
  const drunkSeat = seats.find((s) => s.role === "drunk");
  if (drunkSeat) {
    const inPlay = new Set(seats.map((s) => s.role));
    const candidates = rolesByTeam(TEAM.TOWNSFOLK)
      .map((r) => r.id)
      .filter((id) => !inPlay.has(id));
    drunkSeat.believedRole = rng.pick(candidates);
  }

  // 占卜师红鲱鱼:一名善良玩家永久被误判为恶魔
  const ftSeat = seats.find((s) => effectiveRole(s) === "fortuneteller");
  if (ftSeat) {
    const goodSeats = seats.filter((s) => s.alignment === "good" && s.seat !== ftSeat.seat);
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
