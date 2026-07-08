import { getScript } from "../scripts/registry.js";

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

function clean(value) {
  return JSON.parse(JSON.stringify(value));
}

function valuesOf(input) {
  if (!input) return [];
  return Array.isArray(input) ? input : Object.values(input);
}

export function calculatePlayerStats(resultsInput) {
  const deduped = new Map();
  for (const item of valuesOf(resultsInput)) {
    if (!item || !item.gameId) continue;
    deduped.set(item.gameId, item);
  }

  const results = [...deduped.values()].filter((item) => item.role === "player");
  const byAlignment = {
    good: results.filter((item) => item.alignment === "good"),
    evil: results.filter((item) => item.alignment === "evil")
  };

  const rate = (items) => {
    if (!items.length) return null;
    const wins = items.filter((item) => item.won).length;
    return Math.round((wins / items.length) * 100);
  };

  return {
    totalGames: results.length,
    goodGames: byAlignment.good.length,
    evilGames: byAlignment.evil.length,
    goodWinRate: rate(byAlignment.good),
    evilWinRate: rate(byAlignment.evil)
  };
}

export function buildPlayerResultFromView(view, options = {}) {
  if (!view || view.phase !== "end" || view.isStoryteller || view.isSpectator || !view.you) {
    return null;
  }

  const gameId = options.gameId || view.gameId;
  if (!gameId || !view.winner || !view.you.alignment) return null;

  return clean({
    gameId,
    replayId: options.replayId || gameId,
    role: "player",
    mode: options.mode || "single",
    roomCode: options.roomCode || view.roomCode || null,
    scriptId: view.scriptId || null,
    scriptName: view.scriptName || null,
    endedAt: options.endedAt || Date.now(),
    winner: view.winner,
    winReason: view.winReason || "",
    alignment: view.you.alignment,
    team: view.you.team || null,
    roleId: view.you.role || null,
    roleName: view.you.roleName || null,
    seat: view.seat,
    playerName: view.name || null,
    won: view.you.alignment === view.winner
  });
}

export function buildReplayFromCore(core, options = {}) {
  if (!core || !core.state || core.state.phase !== "end") return null;

  const state = core.state;
  const gameId = options.gameId;
  const createdBy = options.createdBy;
  if (!gameId || !createdBy) return null;

  const script = getScript(state.scriptId);
  const participants = {};
  for (const player of state.players || []) {
    if (player.isHuman && player.id && !String(player.id).startsWith("ai-")) {
      participants[player.id] = true;
    }
  }

  const players = (state.players || []).map((player) => {
    const role = script.roles[player.role];
    return {
      id: player.id,
      seat: player.seat,
      name: player.name,
      isHuman: !!player.isHuman,
      roleId: player.role,
      roleName: role ? role.name : player.role,
      team: role ? role.team : null,
      alignment: player.alignment,
      alive: !!player.alive,
      ghostVote: !!player.ghostVote,
      privateLog: Array.isArray(player.privateLog) ? player.privateLog : []
    };
  });

  return clean({
    gameId,
    createdBy,
    participants,
    mode: options.mode || "single",
    roomCode: options.roomCode || null,
    scriptId: state.scriptId || script.id,
    scriptName: state.scriptName || script.name,
    startedAt: options.startedAt || null,
    endedAt: options.endedAt || Date.now(),
    winner: state.winner,
    winReason: state.winReason || "",
    day: state.day,
    night: state.night,
    players,
    publicLog: (state.log || []).filter((entry) => entry.type !== "storyteller"),
    storytellerNotes: state.storytellerNotes || [],
    chat: core.getAllChat ? core.getAllChat() : [],
    finalState: core.serialize ? core.serialize() : null
  });
}

export function sortedResults(resultsInput) {
  return valuesOf(resultsInput)
    .filter((item) => item && item.gameId)
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
}
