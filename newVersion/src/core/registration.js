/**
 * 通用"注册"机制:查验类能力眼中一名玩家的阵营/类别/角色。
 * 引擎与信息生成不关心具体是谁会误注册 —— 角色在剧本数据里声明 misregister
 * 配置即可获得"可能被误判"的特性(如 TB 的间谍、隐士):
 *
 *   misregister: {
 *     chance: 0.75,               // auto 模式下触发误注册的概率
 *     alignment: "good",          // 误注册时对外显示的阵营
 *     teams: [                    // 误注册时显示的类别,按顺序掷骰,最后一项为兜底
 *       { team: TEAM.TOWNSFOLK, chance: 0.8 },
 *       { team: TEAM.OUTSIDER }
 *     ]
 *   }
 *
 * 非 auto 模式下注册结果由说书人裁定,剧本行为模块据此生成候选项。
 */
import { TEAM } from "./constants.js";
import { resolveScript, rolesByTeam } from "../scripts/registry.js";

/** 角色是否存在注册歧义(声明了 misregister) */
export function isFlexible(player, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const role = script.roles[player.role];
  return !!(role && role.misregister);
}

/** 本次查验中该玩家的注册结果(auto 模式:按配置概率随机) */
export function registrationOf(player, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const role = script.roles[player.role];
  const mis = role && role.misregister;
  if (mis && rng.chance(mis.chance)) {
    let team = mis.teams[mis.teams.length - 1].team;
    for (const entry of mis.teams) {
      if (entry.chance == null || rng.chance(entry.chance)) {
        team = entry.team;
        break;
      }
    }
    const fakeRole = rng.pick(rolesByTeam(script, team));
    return { alignment: mis.alignment, team, roleId: fakeRole.id };
  }
  return { alignment: player.alignment, team: role.team, roleId: player.role };
}

export function registersAsDemon(player, rng, scriptOrId) {
  const script = resolveScript(scriptOrId);
  return registrationOf(player, rng, script).team === TEAM.DEMON;
}

export function registersAsEvil(player, rng, scriptOrId) {
  return registrationOf(player, rng, scriptOrId).alignment === "evil";
}

/** 玩家在某注册组合下是否算邪恶(mis=true 表示按误注册结果) */
export function evilUnder(player, mis, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const conf = script.roles[player.role] && script.roles[player.role].misregister;
  if (conf && mis) return conf.alignment === "evil";
  return player.alignment === "evil";
}

/** 枚举一组歧义玩家的注册组合,收集统计值(供说书人候选项生成) */
export function enumerateFlexCombos(flexSeats, evaluate) {
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
