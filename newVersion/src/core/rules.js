/**
 * 核心规则判定:胜负条件与投票结果。独立成模块以便单元测试。
 */
import { TEAM, resolveScript } from "../scripts/registry.js";

/**
 * 默认胜负判定(经典 BotC):恶魔全灭 → 善良胜;仅剩两名存活 → 邪恶胜。
 */
export function defaultCheckWin(players, script) {
  const alive = players.filter((p) => p.alive);
  const demonAlive = alive.some((p) => script.roles[p.role].team === TEAM.DEMON);

  if (!demonAlive) {
    return { winner: "good", reason: "恶魔死亡,善良阵营获胜!" };
  }
  if (alive.length <= 2) {
    return { winner: "evil", reason: "小镇只剩两名存活玩家,邪恶阵营获胜!" };
  }
  return null;
}

/**
 * 检查是否有一方获胜。剧本可通过 behaviors.checkWin(players, script, defaultCheckWin)
 * 覆盖默认判定(如恶魔不止一个、或有额外终局条件的剧本)。
 * 返回 null 或 { winner: "good"|"evil", reason }。
 */
export function checkWin(players, scriptOrId) {
  const script = resolveScript(scriptOrId);
  const custom = script.behaviors && script.behaviors.checkWin;
  if (typeof custom === "function") return custom(players, script, defaultCheckWin);
  return defaultCheckWin(players, script);
}

/**
 * 投票结果判定。
 * count: 本次得票; aliveCount: 存活人数; onBlock: 当前处决台 { seat, votes } | null
 */
export function resolveVoteResult(count, aliveCount, onBlock) {
  const threshold = Math.ceil(aliveCount / 2);
  if (count < threshold) return { outcome: "fail", threshold };
  const best = onBlock ? onBlock.votes : 0;
  if (count > best) return { outcome: "block", threshold };
  if (count === best) return { outcome: "tie", threshold };
  return { outcome: "fail", threshold };
}
