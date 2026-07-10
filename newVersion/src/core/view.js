/**
 * 玩家视角与说书人视角投影。
 * 玩家视角只暴露其应知信息;说书人视角用于完整魔典和裁定控制台。
 */
import { TEAM_LABELS, ALIGNMENT_LABELS, resolveScript, roleName as scriptRoleName } from "../scripts/registry.js";
import { effectiveRole } from "./setup.js";
import { isDayActionable } from "./constants.js";
import { getMasterSeat, hasStatus, isAbilityUsed } from "./state.js";

function viewScript(stateOrScript, maybeScript) {
  if (maybeScript && maybeScript.roles) return maybeScript;
  if (stateOrScript && stateOrScript.roles) return stateOrScript;
  return resolveScript(stateOrScript && stateOrScript.scriptId);
}

function roleName(script, roleId) {
  return scriptRoleName(script, roleId);
}

function dayActionsFor(state, me, script, myRole) {
  if (!isDayActionable(state) || !me.alive) return [];
  return (script.dayActions || []).filter((action) => {
    if (action.onceState && isAbilityUsed(me, action.onceState.roleId || action.roleId || myRole)) return false;
    if (action.roleId && myRole !== action.roleId && !action.publicClaimable) return false;
    return !action.stages || action.stages.includes(state.dayStage);
  }).map((action) => ({
    actionType: action.actionType,
    roleId: action.roleId || null,
    icon: action.icon || "action",
    label: myRole === action.roleId ? action.label : (action.bluffLabel || action.label),
    confirmLabel: action.confirmLabel || action.label,
    hint: myRole === action.roleId ? (action.hint || "") : (action.bluffHint || action.hint || ""),
    targetPolicy: action.targetPolicy || { count: 1, aliveOnly: true, notSelf: true },
    // AI 玩家决策所需的剧本配置(对真人玩家无影响)
    announceTemplate: action.announceTemplate || null,
    aiGuide: action.aiGuide || null
  }));
}
export function playerView(state, seat, scriptArg) {
  const script = viewScript(state, scriptArg);
  const me = state.players[seat];
  const ended = state.phase === "end";
  const myRole = effectiveRole(me);
  const roleDef = script.roles[myRole];
  const evilInfo = me.evilInfo
    ? {
        demonSeat: me.evilInfo.demonSeat,
        minionSeats: Array.isArray(me.evilInfo.minionSeats) ? me.evilInfo.minionSeats : [],
        bluffs: Array.isArray(me.evilInfo.bluffs) ? me.evilInfo.bluffs : []
      }
    : null;

  return {
    type: "player",
    scriptId: state.scriptId || script.id,
    scriptName: script.name,
    seat,
    name: me.name,
    phase: state.phase,
    dayStage: state.dayStage,
    dayStageEndsAt: state.dayStageEndsAt || null,
    night: state.night,
    day: state.day,
    winner: state.winner,
    winReason: state.winReason,

    you: {
      role: myRole,
      roleName: roleName(script, myRole),
      team: roleDef.team,
      teamLabel: TEAM_LABELS[roleDef.team],
      alignment: me.alignment,
      alignmentLabel: ALIGNMENT_LABELS[me.alignment],
      ability: roleDef.ability,
      alive: me.alive,
      ghostVote: me.ghostVote,
      usedAbility: isAbilityUsed(me, myRole),
      master: getMasterSeat(me),
      privateLog: Array.isArray(me.privateLog) ? me.privateLog : [],
      evilInfo
    },

    seats: state.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      isHuman: p.isHuman,
      avatar: p.avatar || null,
      alive: p.alive,
      ghostVote: p.ghostVote,
      revealedRole: ended ? p.role : null,
      revealedAlignment: ended ? p.alignment : null
    })),

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
          votes: state.currentVote.votes,
          isMyTurn: state.currentVote.order[state.currentVote.index] === seat
        }
      : null,

    pendingAction:
      state.pendingAction && state.pendingAction.seat === seat ? state.pendingAction : null,
    nightActive: state.phase === "night",
    // 说书人正在裁定(内容保密,玩家只知道在等待)
    storytellerDeciding: !!state.pendingStorytellerDecision,
    // 说书人裁定记录不对玩家公开
    log: state.log.filter((l) => l.type !== "storyteller"),
    announcements: state.announcements || [],

    canNominate:
      state.phase === "day" &&
      // 有说书人主持时,提名要等说书人开放;auto 模式全天可提名
      (state.storytellerMode !== "auto"
        ? state.dayStage === "nominations"
        : isDayActionable(state)) &&
      me.alive && !state.nominatorsToday.includes(seat),
    canVote:
      !!state.currentVote &&
      state.currentVote.order[state.currentVote.index] === seat,
    // 白天是否可宣布黄昏(UI 再按 isHost 过滤;非房主玩家不会看到按钮)
    availableDayActions: dayActionsFor(state, me, script, myRole),
    canEndDay:
      isDayActionable(state) &&
      !state.pendingStorytellerDecision
  };
}

export function storytellerView(state, scriptArg) {
  const script = viewScript(state, scriptArg);
  return {
    type: "storyteller",
    isStoryteller: true,
    scriptId: state.scriptId || script.id,
    scriptName: script.name,
    phase: state.phase,
    dayStage: state.dayStage,
    dayStageEndsAt: state.dayStageEndsAt || null,
    night: state.night,
    day: state.day,
    winner: state.winner,
    winReason: state.winReason,
    pendingAction: state.pendingAction,
    pendingStorytellerDecision: state.pendingStorytellerDecision || null,
    nightQueue: state.nightQueue,
    nightIndex: state.nightIndex,
    nightKills: state.nightKills,
    executedToday: state.executedToday,
    onBlock: state.onBlock,
    currentVote: state.currentVote,
    nominations: state.nominations,
    nominatedToday: state.nominatedToday,
    nominatorsToday: state.nominatorsToday,
    storytellerNotes: state.storytellerNotes || [],
    log: state.log,
    seats: state.players.map((p) => {
      const role = script.roles[p.role];
      return {
        seat: p.seat,
        id: p.id,
        name: p.name,
        isHuman: p.isHuman,
        avatar: p.avatar || null,
        persona: p.persona,
        role: p.role,
        roleName: roleName(script, p.role),
        team: role.team,
        teamLabel: TEAM_LABELS[role.team],
        alignment: p.alignment,
        alignmentLabel: ALIGNMENT_LABELS[p.alignment],
        effectiveRole: effectiveRole(p),
        believedRole: p.believedRole,
        alive: p.alive,
        ghostVote: p.ghostVote,
        poisonedBy: p.poisonedBy,
        protectedBy: p.protectedBy,
        master: getMasterSeat(p),
        redHerring: hasStatus(p, "redHerring") || p.redHerring,
        usedAbility: isAbilityUsed(p, p.role),
        diedTonight: p.diedTonight,
        evilInfo: p.evilInfo
          ? {
              demonSeat: p.evilInfo.demonSeat,
              minionSeats: Array.isArray(p.evilInfo.minionSeats) ? p.evilInfo.minionSeats : [],
              bluffs: Array.isArray(p.evilInfo.bluffs) ? p.evilInfo.bluffs : []
            }
          : null,
        privateLog: Array.isArray(p.privateLog) ? p.privateLog : []
      };
    }),
    canEndDay: isDayActionable(state),
    canOpenNominations: state.phase === "day" && ["discussion", "whispers"].includes(state.dayStage),
    canOpenWhispers: state.phase === "day" && state.dayStage === "discussion"
  };
}

export function spectatorView(state, scriptArg) {
  const script = viewScript(state, scriptArg);
  const ended = state.phase === "end";
  return {
    type: "spectator",
    isSpectator: true,
    scriptId: state.scriptId || script.id,
    scriptName: script.name,
    phase: state.phase,
    dayStage: state.dayStage,
    dayStageEndsAt: state.dayStageEndsAt || null,
    night: state.night,
    day: state.day,
    winner: state.winner,
    winReason: state.winReason,
    currentVote: state.currentVote,
    onBlock: state.onBlock,
    nominations: state.nominations,
    nominatedToday: state.nominatedToday,
    nominatorsToday: state.nominatorsToday,
    storytellerDeciding: !!state.pendingStorytellerDecision,
    seats: state.players.map((p) => ({
      seat: p.seat,
      id: p.id,
      name: p.name,
      isHuman: p.isHuman,
      avatar: p.avatar || null,
      alive: p.alive,
      ghostVote: p.ghostVote,
      revealedRole: ended ? p.role : null,
      revealedRoleName: ended ? roleName(script, p.role) : null,
      revealedAlignment: ended ? p.alignment : null
    })),
    pendingAction: null,
    canNominate: false,
    canVote: false,
    availableDayActions: [],
    canEndDay: false,
    log: state.log.filter((l) => l.type !== "storyteller"),
    announcements: state.announcements || []
  };
}

