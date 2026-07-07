/**
 * 核心规则判定:胜负条件与投票结果。独立成模块以便单元测试。
 */
import { ROLES, TEAM } from "./data/roles.js";

/**
 * 检查是否有一方获胜。
 * 返回 null 或 { winner: "good"|"evil", reason }。
 */
export function checkWin(players) {
  const alive = players.filter((p) => p.alive);
  const demonAlive = alive.some((p) => ROLES[p.role].team === TEAM.DEMON);

  // 恶魔全部死亡且无法产生新恶魔 → 善良获胜
  if (!demonAlive) {
    return { winner: "good", reason: "恶魔死亡,善良阵营获胜!" };
  }
  // 只剩两名存活玩家 → 邪恶获胜
  if (alive.length <= 2) {
    return { winner: "evil", reason: "小镇只剩两名存活玩家,邪恶阵营获胜!" };
  }
  return null;
}

/**
 * 投票结果判定。
 * count: 本次得票; aliveCount: 存活人数; onBlock: 当前处决台 { seat, votes } | null
 * 规则:得票 >= 存活半数(向上取整)才有效;
 *   高于当前最高票 → 上处决台;与最高票持平 → 清空处决台(平票无人被处决)。
 */
export function resolveVoteResult(count, aliveCount, onBlock) {
  const threshold = Math.ceil(aliveCount / 2);
  if (count < threshold) return { outcome: "fail", threshold };
  const best = onBlock ? onBlock.votes : 0;
  if (count > best) return { outcome: "block", threshold };
  if (count === best) return { outcome: "tie", threshold };
  return { outcome: "fail", threshold };
}
