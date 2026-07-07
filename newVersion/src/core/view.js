/**
 * 玩家视角投影:从完整状态生成某个座位"应该看到"的信息。
 * 单机渲染、联机私有数据下发、AI 提示词构建三处共用 —— 这是防作弊的唯一出口。
 */
import { ROLES, TEAM, TEAM_LABELS, ALIGNMENT_LABELS, roleName } from "./data/roles.js";
import { effectiveRole } from "./setup.js";

export function playerView(state, seat) {
  const me = state.players[seat];
  const ended = state.phase === "end";
  const myRole = effectiveRole(me); // 酒鬼看到伪装身份
  const roleDef = ROLES[myRole];

  return {
    seat,
    name: me.name,
    phase: state.phase,
    dayStage: state.dayStage,
    night: state.night,
    day: state.day,
    winner: state.winner,
    winReason: state.winReason,

    // 自己的秘密信息
    you: {
      role: myRole,
      roleName: roleName(myRole),
      team: roleDef.team,
      teamLabel: TEAM_LABELS[roleDef.team],
      alignment: me.alignment,
      alignmentLabel: ALIGNMENT_LABELS[me.alignment],
      ability: roleDef.ability,
      alive: me.alive,
      ghostVote: me.ghostVote,
      usedAbility: me.usedAbility,
      master: me.master,
      privateLog: me.privateLog,
      // 邪恶阵营互认信息(首夜发放,7人及以上)
      evilInfo: me.evilInfo || null
    },

    // 公开的座位信息(死亡状态、遗书票是公开的;身份不公开)
    seats: state.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      isHuman: p.isHuman,
      alive: p.alive,
      ghostVote: p.ghostVote,
      // 游戏结束后公开全部身份
      revealedRole: ended ? p.role : null,
      revealedAlignment: ended ? p.alignment : null
    })),

    // 白天公开信息
    nominations: state.nominations,
    nominatedToday: state.nominatedToday,
    nominatorsToday: state.nominatorsToday,
    onBlock: state.onBlock,
    currentVote: state.currentVote
      ? {
          nominator: state.currentVote.nominator,
          nominee: state.currentVote.nominee,
          order: state.currentVote.order,
          index: state.currentVote.index,
          votes: state.currentVote.votes, // 举手是公开的
          isMyTurn: state.currentVote.order[state.currentVote.index] === seat
        }
      : null,

    // 夜晚:只暴露"轮到我了"的行动请求,不泄露别人的行动
    pendingAction:
      state.pendingAction && state.pendingAction.seat === seat ? state.pendingAction : null,
    nightActive: state.phase === "night",

    // 公开日志
    log: state.log,

    // 我能执行的动作(UI/AI 决策依据)
    canNominate:
      state.phase === "day" && state.dayStage === "discussion" &&
      me.alive && !state.nominatorsToday.includes(seat),
    canVote:
      !!state.currentVote &&
      state.currentVote.order[state.currentVote.index] === seat,
    canSlay:
      state.phase === "day" && state.dayStage === "discussion" &&
      me.alive && !me.usedAbility,
    canEndDay: state.phase === "day" && state.dayStage === "discussion"
  };
}

/** 旁观者/结束后视角:全部公开 */
export function spectatorView(state) {
  return {
    phase: state.phase,
    night: state.night,
    day: state.day,
    winner: state.winner,
    winReason: state.winReason,
    seats: state.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      alive: p.alive,
      role: state.phase === "end" ? p.role : null
    })),
    log: state.log
  };
}
