import { describe, expect, it } from "vitest";
import {
  buildPlayerResultFromView,
  buildReplayFromCore,
  calculatePlayerStats
} from "../src/session/gameHistory.js";

const endedPlayerView = {
  type: "player",
  phase: "end",
  gameId: "game-1",
  scriptId: "trouble-brewing",
  scriptName: "Trouble Brewing",
  winner: "good",
  winReason: "The demon died.",
  seat: 0,
  name: "Alice",
  you: {
    alignment: "good",
    team: "townsfolk",
    role: "chef",
    roleName: "Chef"
  }
};

describe("profile history helpers", () => {
  it("calculates total games and alignment win rates with duplicate game ids collapsed", () => {
    const stats = calculatePlayerStats([
      { gameId: "a", role: "player", alignment: "good", won: true },
      { gameId: "a", role: "player", alignment: "good", won: true },
      { gameId: "b", role: "player", alignment: "good", won: false },
      { gameId: "c", role: "player", alignment: "evil", won: true },
      { gameId: "d", role: "storyteller", alignment: null, won: false }
    ]);

    expect(stats.totalGames).toBe(3);
    expect(stats.goodGames).toBe(2);
    expect(stats.evilGames).toBe(1);
    expect(stats.goodWinRate).toBe(50);
    expect(stats.evilWinRate).toBe(100);
  });

  it("builds a player result from an ended player view", () => {
    const result = buildPlayerResultFromView(endedPlayerView, {
      mode: "single",
      endedAt: 123
    });

    expect(result).toMatchObject({
      gameId: "game-1",
      role: "player",
      alignment: "good",
      winner: "good",
      won: true,
      roleId: "chef",
      endedAt: 123
    });
  });

  it("does not build player results for storyteller or spectator views", () => {
    expect(buildPlayerResultFromView({ ...endedPlayerView, isStoryteller: true })).toBe(null);
    expect(buildPlayerResultFromView({ ...endedPlayerView, isSpectator: true })).toBe(null);
  });

  it("builds a replay snapshot with participants, logs, chat, and private records", () => {
    const core = {
      state: {
        phase: "end",
        scriptId: "trouble-brewing",
        scriptName: "Trouble Brewing",
        winner: "evil",
        winReason: "Only two players live.",
        day: 2,
        night: 2,
        log: [
          { type: "system", text: "start" },
          { type: "storyteller", text: "hidden ruling" }
        ],
        storytellerNotes: [{ type: "decision", text: "ruling" }],
        players: [
          {
            id: "uid-1",
            seat: 0,
            name: "Alice",
            isHuman: true,
            role: "chef",
            alignment: "good",
            alive: false,
            ghostVote: false,
            privateLog: [{ text: "info" }]
          },
          {
            id: "ai-1",
            seat: 1,
            name: "Bot",
            isHuman: false,
            role: "imp",
            alignment: "evil",
            alive: true,
            ghostVote: false,
            privateLog: []
          }
        ]
      },
      getAllChat: () => [{ fromName: "Alice", text: "hello", to: null }],
      serialize: () => ({ engineState: { phase: "end" } })
    };

    const replay = buildReplayFromCore(core, {
      gameId: "game-2",
      createdBy: "host-1",
      mode: "multi",
      endedAt: 456
    });

    expect(replay.participants).toEqual({ "uid-1": true });
    expect(replay.publicLog).toEqual([{ type: "system", text: "start" }]);
    expect(replay.storytellerNotes).toEqual([{ type: "decision", text: "ruling" }]);
    expect(replay.chat).toHaveLength(1);
    expect(replay.players[0].privateLog).toEqual([{ text: "info" }]);
  });
});
