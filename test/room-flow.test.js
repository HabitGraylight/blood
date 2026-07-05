const test = require("node:test");
const assert = require("node:assert/strict");
const { createRoomStore } = require("../src/server/room-store.js");

test("multiple players can join, host can deal, player views stay private", async () => {
  const store = createRoomStore();
  const host = store.createRoom("Friday Clocktower", "Host");

  const players = await Promise.all(
    ["Ada", "Ben", "Cy", "Dee"].map((name) => Promise.resolve(store.joinRoom(host.roomId, name)))
  );

  const hostState = store.getState(host.roomId, host.clientId, host.token);
  assert.equal(hostState.room.playerCount, 5);
  assert.equal(hostState.me.isHost, true);
  assert.deepEqual(
    hostState.game.players.map((player) => player.name),
    ["Host", "Ada", "Ben", "Cy", "Dee"]
  );

  assert.throws(
    () => store.applyAction(host.roomId, players[0].clientId, players[0].token, "advancePhase", {}),
    /只有房主可以改房间设置/
  );

  store.applyAction(host.roomId, host.clientId, host.token, "autoBag", {});
  store.applyAction(host.roomId, host.clientId, host.token, "dealRoles", {});
  store.applyAction(host.roomId, host.clientId, host.token, "startFirstNight", {});

  const dealtHostState = store.getState(host.roomId, host.clientId, host.token);
  assert.equal(dealtHostState.game.phase, "firstNight");
  assert.equal(dealtHostState.game.players.every((player) => player.roleId), true);

  const adaState = store.getState(host.roomId, players[0].clientId, players[0].token);
  const adaSelf = adaState.game.players.find((player) => player.id === adaState.me.playerId);
  const visibleOtherRoles = adaState.game.players
    .filter((player) => player.id !== adaState.me.playerId)
    .filter((player) => player.roleId || player.shownRoleId || player.alignment);

  assert.ok(adaSelf.shownRoleId, "a player sees their own shown role");
  assert.equal(visibleOtherRoles.length, 0, "a player cannot see other players' hidden roles or alignment");
});

test("in LLM storyteller mode the room owner is a player, not the storyteller", async () => {
  const store = createRoomStore();
  const host = store.createRoom("LLM Storyteller", "Owner");
  await Promise.all(["Ada", "Ben", "Cy", "Dee"].map((name) => Promise.resolve(store.joinRoom(host.roomId, name))));

  store.applyAction(host.roomId, host.clientId, host.token, "setMode", { mode: "llm" });
  store.applyAction(host.roomId, host.clientId, host.token, "autoBag", {});
  store.applyAction(host.roomId, host.clientId, host.token, "dealRoles", {});

  const ownerState = store.getState(host.roomId, host.clientId, host.token);
  const ownerSelf = ownerState.game.players.find((player) => player.id === ownerState.me.playerId);
  const hiddenFromOwner = ownerState.game.players
    .filter((player) => player.id !== ownerState.me.playerId)
    .every((player) => !player.roleId && !player.shownRoleId && !player.alignment);

  assert.equal(ownerState.me.isHost, true);
  assert.equal(ownerState.me.isOwner, true);
  assert.equal(ownerState.me.isStoryteller, false);
  assert.ok(ownerSelf.shownRoleId, "the owner receives a player identity in LLM mode");
  assert.equal(hiddenFromOwner, true, "the owner cannot see other players' hidden roles in LLM mode");
  assert.equal(ownerState.game.selectedBag.length, 0, "the owner cannot inspect the hidden bag in LLM mode");
  assert.equal(ownerState.game.setup.selectedBagCount, 5, "the owner can still see setup progress");

  assert.throws(
    () =>
      store.applyAction(host.roomId, host.clientId, host.token, "updatePlayer", {
        playerId: ownerState.game.players[1].id,
        patch: { roleId: "imp" }
      }),
    /只有真人说书人可以查看或修改魔典/
  );
});

test("AI players join as real players, receive roles, and can only be driven by the owner", async () => {
  const store = createRoomStore();
  const host = store.createRoom("AI Table", "Host");
  const [ada, ben, cy] = await Promise.all(
    ["Ada", "Ben", "Cy"].map((name) => Promise.resolve(store.joinRoom(host.roomId, name)))
  );

  store.applyAction(host.roomId, host.clientId, host.token, "addAiPlayer", {
    name: "AI 阿钟",
    persona: "谨慎、喜欢从投票行为找矛盾。"
  });

  const withAi = store.getState(host.roomId, host.clientId, host.token);
  const aiPlayer = withAi.game.players.find((player) => player.ai);
  assert.equal(withAi.room.playerCount, 5);
  assert.ok(aiPlayer, "AI player is represented as a real player");
  assert.equal(aiPlayer.aiProfile.persona, "谨慎、喜欢从投票行为找矛盾。");

  store.applyAction(host.roomId, host.clientId, host.token, "autoBag", {});
  store.applyAction(host.roomId, host.clientId, host.token, "dealRoles", {});

  const dealt = store.getState(host.roomId, host.clientId, host.token);
  const dealtAi = dealt.game.players.find((player) => player.ai);
  assert.ok(dealtAi.roleId, "AI player receives a real role");

  assert.throws(
    () =>
      store.applyAction(host.roomId, ada.clientId, ada.token, "sendAiChat", {
        playerId: dealtAi.id,
        to: "public",
        text: "我是冒充的 AI。"
      }),
    /只有房主可以改房间设置/
  );

  store.applyAction(host.roomId, host.clientId, host.token, "sendAiChat", {
    playerId: dealtAi.id,
    to: "public",
    text: "我先看投票和发言节奏，不急着带票。"
  });

  const adaState = store.getState(host.roomId, ada.clientId, ada.token);
  assert.equal(adaState.game.chats.length, 1);
  assert.equal(adaState.game.chats[0].from, dealtAi.id);
  assert.equal(adaState.game.chats[0].ai, true);

  const cyState = store.getState(host.roomId, cy.clientId, cy.token);
  assert.equal(cyState.game.players.some((player) => player.ai), true);
  assert.equal(ben.roomId, host.roomId);
});

test("private room chat is visible only to room members and the host", async () => {
  const store = createRoomStore();
  const host = store.createRoom("Chat Test", "Host");
  const [ada, ben, cy] = await Promise.all(
    ["Ada", "Ben", "Cy"].map((name) => Promise.resolve(store.joinRoom(host.roomId, name)))
  );

  const hostState = store.getState(host.roomId, host.clientId, host.token);
  const adaPlayer = hostState.game.players.find((player) => player.name === "Ada");
  const benPlayer = hostState.game.players.find((player) => player.name === "Ben");

  store.applyAction(host.roomId, host.clientId, host.token, "createPrivateRoom", {
    memberIds: [adaPlayer.id, benPlayer.id]
  });

  const adaStateWithRoom = store.getState(host.roomId, ada.clientId, ada.token);
  const privateRoom = adaStateWithRoom.game.rooms[0];
  assert.ok(privateRoom, "Ada sees the private room she belongs to");

  store.applyAction(host.roomId, ada.clientId, ada.token, "sendChat", {
    to: `room:${privateRoom.id}`,
    text: "Ben, 我想私聊一下今天的提名。"
  });

  const hostAfterChat = store.getState(host.roomId, host.clientId, host.token);
  const adaAfterChat = store.getState(host.roomId, ada.clientId, ada.token);
  const benAfterChat = store.getState(host.roomId, ben.clientId, ben.token);
  const cyAfterChat = store.getState(host.roomId, cy.clientId, cy.token);

  assert.equal(hostAfterChat.game.chats.length, 1, "host can audit private chat");
  assert.equal(adaAfterChat.game.chats.length, 1, "sender sees private chat");
  assert.equal(benAfterChat.game.chats.length, 1, "room member sees private chat");
  assert.equal(cyAfterChat.game.chats.length, 0, "non-member cannot see private chat");
});

test("subscribers receive updates when players join and the host changes phase", () => {
  const store = createRoomStore();
  const host = store.createRoom("Live Sync", "Host");
  const snapshots = [];
  const unsubscribe = store.subscribe(host.roomId, host.clientId, host.token, (snapshot) => {
    snapshots.push(snapshot);
  });

  store.joinRoom(host.roomId, "Ada");
  store.applyAction(host.roomId, host.clientId, host.token, "advancePhase", {});
  unsubscribe();
  store.joinRoom(host.roomId, "Ben");

  assert.equal(snapshots.length, 3);
  assert.equal(snapshots[0].room.playerCount, 1);
  assert.equal(snapshots[1].room.playerCount, 2);
  assert.equal(snapshots[2].game.phase, "firstNight");
});
