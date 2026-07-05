const crypto = require("crypto");
const { DEFAULT_SCRIPTS, DEFAULT_SETUP } = require("../shared/game-data.js");

function createRoomStore() {
  const rooms = new Map();

  function createRoom(roomName, hostName) {
    const id = makeRoomId(rooms);
    const host = makeClient(hostName || "说书人");
    const room = {
      id,
      name: cleanText(roomName, 36) || "钟楼房间",
      hostId: host.id,
      clients: new Map([[host.id, host]]),
      subscribers: new Set(),
      game: createGame()
    };
    room.game.players.push(makePlayer(host.name, 1, host.id));
    log(room, "系统", `${host.name} 创建了房间。`, "public");
    rooms.set(id, room);
    return sessionPayload(room, host);
  }

  function joinRoom(roomId, name) {
    const room = requireRoom(roomId);
    const client = makeClient(name || "玩家");
    room.clients.set(client.id, client);
    room.game.players.push(makePlayer(client.name, room.game.players.length + 1, client.id));
    log(room, "玩家", `${client.name} 加入了房间。`, "public");
    broadcast(room);
    return sessionPayload(room, client);
  }

  function getState(roomId, clientId, token) {
    const { room, client } = requireSession(roomId, clientId, token);
    return sanitizeRoom(room, client);
  }

  function applyAction(roomId, clientId, token, type, payload = {}) {
    const { room, client } = requireSession(roomId, clientId, token);
    const result = mutateRoom(room, client, type, payload);
    broadcast(room);
    return { ok: true, ...result };
  }

  function getStorytellerLlmContext(roomId, clientId, token, instruction = "") {
    const { room, client } = requireSession(roomId, clientId, token);
    if (!isOwner(room, client)) throw httpError(403, "只有房主可以调用 LLM 说书人。");
    return {
      instruction,
      room: {
        id: room.id,
        name: room.name,
        hostName: room.clients.get(room.hostId)?.name || "房主"
      },
      requester: {
        clientId: client.id,
        name: client.name,
        isOwner: true,
        isStoryteller: isStoryteller(room, client)
      },
      balance: buildBalanceSnapshot(room),
      game: deepClone(room.game)
    };
  }

  function getAiPlayerLlmContext(roomId, clientId, token, playerId, instruction = "") {
    const { room, client } = requireSession(roomId, clientId, token);
    if (!isOwner(room, client)) throw httpError(403, "只有房主可以驱动 AI 玩家。");
    const player = room.game.players.find((item) => item.id === playerId);
    if (!player?.ai) throw httpError(400, "请选择一个 AI 玩家。");
    return buildAiPlayerContext(room, player, instruction);
  }

  function subscribe(roomId, clientId, token, callback) {
    const { room, client } = requireSession(roomId, clientId, token);
    const subscriber = { clientId: client.id, callback };
    room.subscribers.add(subscriber);
    callback(sanitizeRoom(room, client));
    return () => {
      room.subscribers.delete(subscriber);
    };
  }

  function authenticate(roomId, clientId, token) {
    const room = rooms.get(normalizeRoomId(roomId));
    if (!room) return null;
    const client = room.clients.get(clientId || "");
    if (!client || client.token !== token) return null;
    return { room, client };
  }

  function requireRoom(roomId) {
    const room = rooms.get(normalizeRoomId(roomId));
    if (!room) throw httpError(404, "房间不存在");
    return room;
  }

  function requireSession(roomId, clientId, token) {
    const session = authenticate(roomId, clientId, token);
    if (!session) throw httpError(403, "未授权");
    return session;
  }

  function broadcast(room) {
    for (const subscriber of room.subscribers) {
      const client = room.clients.get(subscriber.clientId);
      if (client) subscriber.callback(sanitizeRoom(room, client));
    }
  }

  return {
    createRoom,
    joinRoom,
    getState,
    applyAction,
    getStorytellerLlmContext,
    getAiPlayerLlmContext,
    subscribe,
    authenticate,
    _rooms: rooms
  };
}

function buildAiPlayerContext(room, player, instruction) {
  return {
    instruction,
    room: {
      id: room.id,
      name: room.name,
      playerCount: room.game.players.length
    },
    aiPlayer: {
      id: player.id,
      name: player.name,
      seat: player.seat,
      alive: player.alive,
      persona: player.aiProfile?.persona || "",
      providerId: player.aiProfile?.providerId || "",
      model: player.aiProfile?.model || "",
      roleId: player.shownRoleId || player.roleId || "",
      visibleRole: roleById(room, player.shownRoleId || player.roleId)?.name || "",
      visibleAlignment: player.alignment || "",
      ghostVote: player.ghostVote
    },
    game: {
      activeScriptId: room.game.activeScriptId,
      phase: room.game.phase,
      day: room.game.day,
      night: room.game.night,
      players: room.game.players.map((item) => ({
        id: item.id,
        name: item.name,
        seat: item.seat,
        alive: item.alive,
        ai: Boolean(item.ai),
        self: item.id === player.id,
        visibleRole: item.id === player.id ? roleById(room, item.shownRoleId || item.roleId)?.name || "" : "",
        visibleAlignment: item.id === player.id ? item.alignment : ""
      })),
      nominations: room.game.nominations.map((item) => ({
        nominator: nameOf(room, item.nominatorId),
        nominee: nameOf(room, item.nomineeId),
        votes: item.votes.map((voterId) => nameOf(room, voterId)),
        threshold: item.threshold,
        phaseLabel: item.phaseLabel
      })),
      chats: room.game.chats
        .filter((message) => canSeeChatForPlayer(room, player.id, message))
        .slice(-30)
        .map((message) => ({
          from: displayActor(room, message.from),
          to: displayRecipient(room, message.to),
          kind: message.kind,
          text: message.text,
          ai: Boolean(message.ai)
        }))
    }
  };
}

function createGame() {
  return {
    scripts: deepClone(DEFAULT_SCRIPTS),
    activeScriptId: DEFAULT_SCRIPTS[0].id,
    storytellerMode: "human",
    llm: { providerId: "", model: "" },
    players: [],
    selectedBag: [],
    phase: "setup",
    day: 0,
    night: 0,
    nominations: [],
    chats: [],
    rooms: [],
    log: []
  };
}

function buildBalanceSnapshot(room) {
  const players = room.game.players;
  const alive = players.filter((player) => player.alive);
  const roleTeamCounts = countRoleTeams(room, players);
  const aliveRoleTeamCounts = countRoleTeams(room, alive);
  const goodAliveCount = alive.filter((player) => player.alignment === "good").length;
  const evilAliveCount = alive.filter((player) => player.alignment === "evil").length;
  const demonAlive = alive.some((player) => roleById(room, player.roleId)?.team === "demon");
  const voteThreshold = alive.length ? Math.ceil(alive.length / 2) : 0;
  return {
    phase: phaseLabel(room.game),
    playerCount: players.length,
    aliveCount: alive.length,
    deadCount: players.length - alive.length,
    goodAliveCount,
    evilAliveCount,
    demonAlive,
    voteThreshold,
    roleTeamCounts,
    aliveRoleTeamCounts,
    recentExecutionsOrDeaths: room.game.log
      .filter((entry) => ["处决", "小恶魔", "胜负", "阶段"].includes(entry.type))
      .slice(-8)
      .map((entry) => ({ type: entry.type, text: entry.text })),
    nominationsToday: room.game.nominations.map((item) => ({
      nominee: nameOf(room, item.nomineeId),
      votes: item.votes.length,
      threshold: item.threshold,
      phaseLabel: item.phaseLabel
    })),
    balancePressure: describeBalancePressure(alive.length, goodAliveCount, evilAliveCount, demonAlive)
  };
}

function countRoleTeams(room, players) {
  return players.reduce(
    (acc, player) => {
      const team = roleById(room, player.roleId)?.team || "unknown";
      acc[team] = (acc[team] || 0) + 1;
      return acc;
    },
    { townsfolk: 0, outsider: 0, minion: 0, demon: 0, unknown: 0 }
  );
}

function describeBalancePressure(aliveCount, goodAliveCount, evilAliveCount, demonAlive) {
  if (!aliveCount) return "未开局或无人存活。";
  if (!demonAlive) return "恶魔已死亡或未发牌；除特殊规则外游戏应接近善良胜利。";
  if (aliveCount <= 3) return "终局压力高，裁量要避免单方无推理空间地直接结束。";
  if (evilAliveCount <= 1 && aliveCount >= 6) return "邪恶存活压力偏高，裁量可适度保留邪恶周旋空间。";
  if (goodAliveCount <= evilAliveCount + 1) return "善良存活压力偏高，裁量可适度提供可推理线索。";
  return "局势未明显失衡，优先维持规则一致性和玩家可推理性。";
}

function mutateRoom(room, client, type, payload) {
  const owner = isOwner(room, client);
  const storyteller = isStoryteller(room, client);
  const playerActions = new Set(["sendChat", "createPrivateRoom"]);
  const ownerActions = new Set([
    "setScript",
    "setMode",
    "setLlm",
    "renamePlayers",
    "addSeat",
    "addAiPlayer",
    "fillSeats",
    "autoBag",
    "dealRoles",
    "clearRoles",
    "startFirstNight",
    "advancePhase",
    "recordVote",
    "executeLeader",
    "replaceScript",
    "importGame",
    "resetRoom"
  ]);
  const storytellerActions = new Set(["bagPlus", "bagMinus", "updatePlayer", "addReminder"]);
  if (!owner && !playerActions.has(type)) {
    throw httpError(403, "只有房主可以改房间设置。");
  }
  if (!storyteller && storytellerActions.has(type)) {
    throw httpError(403, "只有真人说书人可以查看或修改魔典。");
  }

  const game = room.game;
  switch (type) {
    case "setScript":
      game.activeScriptId = payload.scriptId;
      game.selectedBag = [];
      log(room, "板子", `切换到 ${activeScript(room).name}。`, "public");
      break;
    case "setMode":
      game.storytellerMode = payload.mode === "llm" ? "llm" : "human";
      log(room, "模式", game.storytellerMode === "llm" ? "切换为 LLM 辅助。" : "切换为真人说书人。", "public");
      break;
    case "setLlm":
      game.llm.providerId = cleanText(payload.providerId, 80);
      game.llm.model = cleanText(payload.model, 100);
      log(room, "LLM", "已更新 LLM 接入配置。");
      break;
    case "renamePlayers":
      renamePlayers(room, payload.names || []);
      break;
    case "addSeat":
      game.players.push(makePlayer(`空座位 ${game.players.length + 1}`, game.players.length + 1, ""));
      log(room, "玩家", "说书人添加了一个空座位。", "public");
      break;
    case "addAiPlayer":
      addAiPlayer(room, payload);
      break;
    case "fillSeats":
      fillSeats(room, Number(payload.targetCount) || 5);
      break;
    case "bagPlus":
      if (roleById(room, payload.roleId)) game.selectedBag.push(payload.roleId);
      break;
    case "bagMinus": {
      const index = game.selectedBag.lastIndexOf(payload.roleId);
      if (index >= 0) game.selectedBag.splice(index, 1);
      break;
    }
    case "autoBag":
      autoBuildBag(room);
      break;
    case "dealRoles":
      dealRoles(room);
      break;
    case "clearRoles":
      game.players = game.players.map((player) => ({
        ...player,
        roleId: "",
        shownRoleId: "",
        alignment: "good",
        poisoned: false,
        drunk: false,
        reminders: []
      }));
      log(room, "发牌", "说书人清空了玩家角色。");
      break;
    case "startFirstNight":
      game.phase = "firstNight";
      game.night = 1;
      game.day = 0;
      resetDailyFlags(room);
      log(room, "阶段", "进入首夜。", "public");
      break;
    case "advancePhase":
      advancePhase(room);
      break;
    case "recordVote":
      recordVote(room, payload);
      break;
    case "executeLeader":
      executeLeader(room);
      break;
    case "updatePlayer":
      updatePlayer(room, payload.playerId, payload.patch || {});
      break;
    case "addReminder":
      addReminder(room, payload.playerId, payload.text);
      break;
    case "sendChat":
      sendChat(room, client, payload);
      break;
    case "sendAiChat":
      sendAiChat(room, client, payload);
      break;
    case "createPrivateRoom":
      createPrivateRoom(room, client, payload.memberIds || []);
      break;
    case "replaceScript":
      replaceScript(room, payload.script);
      break;
    case "importGame":
      importGame(room, payload.game);
      break;
    case "resetRoom":
      room.game = createGame();
      room.game.players.push(makePlayer(client.name, 1, client.id));
      log(room, "系统", "房间已重置。", "public");
      break;
    default:
      throw httpError(400, `未知操作：${type}`);
  }
  return {};
}

function renamePlayers(room, names) {
  const clean = names.map((name) => cleanText(name, 28)).filter(Boolean).slice(0, 20);
  room.game.players = clean.map((name, index) => {
    const existing = room.game.players[index];
    return existing ? { ...existing, name, seat: index + 1 } : makePlayer(name, index + 1, "");
  });
  log(room, "玩家", `说书人设置了 ${room.game.players.length} 个座位。`, "public");
}

function addAiPlayer(room, payload) {
  const name = cleanText(payload.name, 28) || `AI 玩家 ${room.game.players.filter((player) => player.ai).length + 1}`;
  const persona = cleanText(payload.persona, 240) || "谨慎、会参与公开讨论，但不会直接暴露隐藏信息。";
  const player = makePlayer(name, room.game.players.length + 1, "", {
    ai: true,
    aiProfile: {
      persona,
      providerId: cleanText(payload.providerId, 80) || "",
      model: cleanText(payload.model, 100) || ""
    }
  });
  room.game.players.push(player);
  log(room, "AI 玩家", `${name} 加入了房间。`, "public");
}

function fillSeats(room, targetCount) {
  const safeTarget = Math.min(Math.max(targetCount, 5), 20);
  while (room.game.players.length < safeTarget) {
    room.game.players.push(makePlayer(`空座位 ${room.game.players.length + 1}`, room.game.players.length + 1, ""));
  }
  log(room, "玩家", `已补到 ${room.game.players.length} 个座位。`, "public");
}

function autoBuildBag(room) {
  const counts = getSetupCounts(room);
  if (!counts) {
    log(room, "发牌袋", "当前人数不在默认 5-15 范围，请手动选择角色。");
    return;
  }

  const script = activeScript(room);
  const selected = [];
  const demonPick = takeRandom(expandRoles(script.roles.filter((item) => item.team === "demon")), counts.demon);
  const minionPick = takeRandom(expandRoles(script.roles.filter((item) => item.team === "minion")), counts.minion);
  selected.push(...demonPick, ...minionPick);

  const adjusted = { ...counts };
  for (const roleId of minionPick) {
    const item = roleById(room, roleId);
    if (item?.setupModifier) {
      for (const [key, value] of Object.entries(item.setupModifier)) {
        adjusted[key] = Math.max(0, (adjusted[key] || 0) + value);
      }
    }
  }

  selected.push(...takeRandom(expandRoles(script.roles.filter((item) => item.team === "townsfolk")), adjusted.townsfolk));
  selected.push(...takeRandom(expandRoles(script.roles.filter((item) => item.team === "outsider")), adjusted.outsider));
  room.game.selectedBag = shuffle(selected);
  log(room, "发牌袋", `已自动抽取：${formatCounts(adjusted)}。`);
}

function dealRoles(room) {
  const game = room.game;
  if (game.selectedBag.length !== game.players.length) {
    log(room, "发牌", `发牌袋 ${game.selectedBag.length} 张，玩家 ${game.players.length} 人，数量需要一致。`);
    return;
  }
  const shuffledRoles = shuffle(game.selectedBag);
  const notInPlayTownsfolk = activeScript(room).roles.filter(
    (item) => item.team === "townsfolk" && !shuffledRoles.includes(item.id)
  );

  game.players = game.players.map((player, index) => {
    const actual = roleById(room, shuffledRoles[index]);
    let shownRoleId = actual?.id || "";
    if (actual?.thinksIsTownsfolk) {
      shownRoleId = takeRandom(notInPlayTownsfolk.map((item) => item.id), 1)[0] || shownRoleId;
    }
    return {
      ...player,
      roleId: actual?.id || "",
      shownRoleId,
      alignment: actual?.team === "minion" || actual?.team === "demon" ? "evil" : "good",
      alive: true,
      poisoned: false,
      drunk: false,
      ghostVote: true,
      nominatedToday: false,
      wasNominatedToday: false,
      reminders: actual?.thinksIsTownsfolk ? ["玩家以为自己是显示角色"] : []
    };
  });
  log(room, "发牌", "说书人已随机发牌。", "public");
}

function resetDailyFlags(room) {
  room.game.players = room.game.players.map((player) => ({
    ...player,
    nominatedToday: false,
    wasNominatedToday: false
  }));
  room.game.nominations = [];
}

function advancePhase(room) {
  const game = room.game;
  if (game.phase === "setup") {
    game.phase = "firstNight";
    game.night = 1;
    resetDailyFlags(room);
    log(room, "阶段", "进入首夜。", "public");
    return;
  }
  if (game.phase === "firstNight" || game.phase === "night") {
    game.phase = "day";
    game.day += 1;
    resetDailyFlags(room);
    log(room, "阶段", `天亮了，进入第 ${game.day} 天。`, "public");
  } else {
    game.phase = "night";
    game.night += 1;
    log(room, "阶段", `入夜，进入第 ${game.night} 夜。`, "public");
  }
}

function recordVote(room, payload) {
  const game = room.game;
  const nominator = game.players.find((player) => player.id === payload.nominatorId);
  const nominee = game.players.find((player) => player.id === payload.nomineeId);
  if (!nominator || !nominee) return;
  if (!nominator.alive) {
    log(room, "提名", `${nominator.name} 已死亡，不能提名。`, "public");
    return;
  }
  if (nominator.nominatedToday || nominee.wasNominatedToday) {
    log(room, "提名", "本日提名限制已触发，未记录。", "public");
    return;
  }
  const votes = Array.isArray(payload.votes) ? payload.votes : [];
  const threshold = Math.ceil(game.players.filter((player) => player.alive).length / 2);
  game.nominations.push({
    id: crypto.randomUUID(),
    nominatorId: nominator.id,
    nomineeId: nominee.id,
    votes,
    threshold,
    at: Date.now(),
    phaseLabel: phaseLabel(game)
  });
  nominator.nominatedToday = true;
  nominee.wasNominatedToday = true;
  for (const voterId of votes) {
    const voter = game.players.find((player) => player.id === voterId);
    if (voter && !voter.alive) voter.ghostVote = false;
  }
  log(room, "投票", `${nominator.name} 提名 ${nominee.name}，获得 ${votes.length} 票，门槛 ${threshold}。`, "public");
}

function executeLeader(room) {
  const game = room.game;
  if (!game.nominations.length) {
    log(room, "处决", "今天还没有投票记录。", "public");
    return;
  }
  const threshold = Math.ceil(game.players.filter((player) => player.alive).length / 2);
  const sorted = game.nominations.slice().sort((a, b) => b.votes.length - a.votes.length);
  const leader = sorted[0];
  const tied = sorted.filter((item) => item.votes.length === leader.votes.length);
  if (leader.votes.length < threshold) {
    log(room, "处决", `最高票 ${leader.votes.length}，未达到门槛 ${threshold}，无人处决。`, "public");
    return;
  }
  if (tied.length > 1) {
    log(room, "处决", `最高票平票：${tied.map((item) => nameOf(room, item.nomineeId)).join("、")}，无人处决。`, "public");
    return;
  }
  killPlayer(room, leader.nomineeId, "处决");
}

function killPlayer(room, playerId, reason) {
  const player = room.game.players.find((item) => item.id === playerId);
  if (!player || !player.alive) return;
  player.alive = false;
  player.ghostVote = true;
  log(room, reason, `${player.name} 死亡。`, "public");
  if (roleById(room, player.roleId)?.team === "demon") {
    log(room, "胜负", "恶魔死亡。通常善良阵营获胜，除非板子有特殊规则。", "public");
  }
}

function updatePlayer(room, playerId, patch) {
  const player = room.game.players.find((item) => item.id === playerId);
  if (!player) return;
  const allowed = ["name", "roleId", "shownRoleId", "alignment", "alive", "poisoned", "drunk", "ghostVote", "reminders"];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) player[key] = patch[key];
  }
  if (patch.roleId && !patch.alignment) {
    const item = roleById(room, patch.roleId);
    player.alignment = item?.team === "minion" || item?.team === "demon" ? "evil" : "good";
  }
  log(room, "玩家状态", `说书人更新了 ${player.name}。`);
}

function addReminder(room, playerId, text) {
  const player = room.game.players.find((item) => item.id === playerId);
  const clean = cleanText(text, 80);
  if (!player || !clean) return;
  player.reminders.push(clean);
  log(room, "标记", `${player.name}: ${clean}`);
}

function sendChat(room, client, payload) {
  const storyteller = isStoryteller(room, client);
  const ownPlayer = room.game.players.find((player) => player.clientId === client.id);
  const from = storyteller ? payload.from || "storyteller" : ownPlayer?.id;
  if (!from) return;
  const to = payload.to || "public";
  const text = cleanText(payload.text, 2000);
  if (!text) return;
  const kind = to === "public" ? "public" : to === "storyteller" || from === "storyteller" ? "whisper" : "private";
  room.game.chats.push({ id: crypto.randomUUID(), from, to, kind, text, at: Date.now() });
  log(room, "聊天", `${displayActor(room, from)} -> ${displayRecipient(room, to)}。`, kind === "public" ? "public" : "host");
}

function sendAiChat(room, client, payload) {
  if (!isOwner(room, client)) throw httpError(403, "只有房主可以驱动 AI 玩家。");
  const player = room.game.players.find((item) => item.id === payload.playerId);
  if (!player?.ai) throw httpError(400, "请选择一个 AI 玩家。");
  const text = cleanText(payload.text, 2000);
  if (!text) return;
  const to = payload.to || "public";
  const kind = to === "public" ? "public" : to === "storyteller" ? "whisper" : "private";
  room.game.chats.push({ id: crypto.randomUUID(), from: player.id, to, kind, text, at: Date.now(), ai: true });
  log(room, "AI 发言", `${player.name} -> ${displayRecipient(room, to)}。`, kind === "public" ? "public" : "host");
}

function createPrivateRoom(room, client, memberIds) {
  const storyteller = isStoryteller(room, client);
  const ownPlayer = room.game.players.find((player) => player.clientId === client.id);
  const members = [...new Set(memberIds)].filter((id) => room.game.players.some((player) => player.id === id));
  if (!storyteller && ownPlayer && !members.includes(ownPlayer.id)) members.push(ownPlayer.id);
  if (members.length < 2) return;
  const privateRoom = { id: crypto.randomUUID(), name: members.map((id) => nameOf(room, id)).join(" / "), members };
  room.game.rooms.push(privateRoom);
  log(room, "私聊", `创建私聊房：${privateRoom.name}`, "public");
}

function replaceScript(room, script) {
  if (!script?.id || !Array.isArray(script.roles)) return;
  const normalized = {
    ...script,
    setupTable: script.setupTable || DEFAULT_SETUP,
    nightOrder: script.nightOrder || { first: [], other: [] }
  };
  const index = room.game.scripts.findIndex((item) => item.id === normalized.id);
  if (index >= 0) room.game.scripts[index] = normalized;
  else room.game.scripts.push(normalized);
  room.game.activeScriptId = normalized.id;
  log(room, "板子", `已保存板子：${normalized.name || normalized.id}。`, "public");
}

function importGame(room, game) {
  if (!game?.scripts || !game?.players) return;
  room.game = {
    ...createGame(),
    ...game,
    log: game.log || []
  };
  log(room, "导入", "说书人导入了房间存档。", "public");
}

function sessionPayload(room, client) {
  return {
    roomId: room.id,
    clientId: client.id,
    token: client.token,
    state: sanitizeRoom(room, client)
  };
}

function sanitizeRoom(room, client) {
  const owner = isOwner(room, client);
  const storyteller = isStoryteller(room, client);
  const ownPlayer = room.game.players.find((player) => player.clientId === client.id);
  const game = room.game;
  return {
    room: {
      id: room.id,
      name: room.name,
      hostName: room.clients.get(room.hostId)?.name || "说书人",
      playerCount: game.players.length
    },
    me: {
      clientId: client.id,
      isHost: owner,
      isOwner: owner,
      isStoryteller: storyteller,
      name: client.name,
      playerId: ownPlayer?.id || ""
    },
    game: {
      scripts: game.scripts,
      activeScriptId: game.activeScriptId,
      storytellerMode: game.storytellerMode,
      llm: owner ? game.llm : { providerId: "", model: "" },
      players: game.players.map((player) => sanitizePlayer(player, storyteller, ownPlayer?.id)),
      selectedBag: storyteller ? game.selectedBag : [],
      setup: {
        selectedBagCount: owner ? game.selectedBag.length : 0
      },
      phase: game.phase,
      day: game.day,
      night: game.night,
      nominations: game.nominations,
      chats: game.chats.filter((message) => canSeeChat(room, client, message)),
      rooms: game.rooms.filter((privateRoom) => storyteller || privateRoom.members.includes(ownPlayer?.id)),
      log: game.log.filter((entry) => storyteller || entry.scope === "public")
    }
  };
}

function sanitizePlayer(player, storyteller, ownPlayerId) {
  if (storyteller) return player;
  const own = player.id === ownPlayerId;
  return {
    id: player.id,
    clientId: own ? player.clientId : "",
    name: player.name,
    seat: player.seat,
    ai: Boolean(player.ai),
    aiProfile: player.ai ? { persona: player.aiProfile?.persona || "" } : undefined,
    alive: player.alive,
    roleId: "",
    shownRoleId: own ? player.shownRoleId || player.roleId : "",
    alignment: own ? player.alignment : "",
    ghostVote: own ? player.ghostVote : false,
    poisoned: false,
    drunk: false,
    reminders: []
  };
}

function canSeeChat(room, client, message) {
  if (isStoryteller(room, client)) return true;
  const ownPlayer = room.game.players.find((player) => player.clientId === client.id);
  if (message.kind === "public") return true;
  if (!ownPlayer) return false;
  if (message.from === ownPlayer.id) return true;
  if (message.to === `player:${ownPlayer.id}`) return true;
  if (message.to?.startsWith("room:")) {
    const privateRoom = room.game.rooms.find((item) => item.id === message.to.slice(5));
    return Boolean(privateRoom?.members.includes(ownPlayer.id));
  }
  return message.to === "storyteller" && message.from === ownPlayer.id;
}

function canSeeChatForPlayer(room, playerId, message) {
  if (message.kind === "public") return true;
  if (message.from === playerId) return true;
  if (message.to === `player:${playerId}`) return true;
  if (message.to?.startsWith("room:")) {
    const privateRoom = room.game.rooms.find((item) => item.id === message.to.slice(5));
    return Boolean(privateRoom?.members.includes(playerId));
  }
  return false;
}

function activeScript(room) {
  return room.game.scripts.find((script) => script.id === room.game.activeScriptId) || room.game.scripts[0];
}

function roleById(room, roleId) {
  return activeScript(room).roles.find((item) => item.id === roleId);
}

function getSetupCounts(room) {
  const count = room.game.players.length;
  return activeScript(room).setupTable?.[count] || DEFAULT_SETUP[count] || null;
}

function makeClient(name) {
  return {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(20).toString("hex"),
    name: cleanText(name, 28) || "玩家",
    joinedAt: Date.now()
  };
}

function makePlayer(name, seat, clientId, extra) {
  return {
    id: crypto.randomUUID(),
    clientId: clientId || "",
    name,
    seat,
    ai: false,
    aiProfile: null,
    roleId: "",
    shownRoleId: "",
    alignment: "good",
    alive: true,
    poisoned: false,
    drunk: false,
    ghostVote: true,
    nominatedToday: false,
    wasNominatedToday: false,
    reminders: [],
    ...(extra || {})
  };
}

function expandRoles(roles) {
  return roles.flatMap((item) => Array.from({ length: Math.max(0, item.copies || 1) }, () => item.id));
}

function takeRandom(items, count) {
  return shuffle(items).slice(0, Math.max(0, count));
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatCounts(counts) {
  return `镇民 ${counts.townsfolk} / 外来者 ${counts.outsider} / 爪牙 ${counts.minion} / 恶魔 ${counts.demon}`;
}

function phaseLabel(game) {
  if (game.phase === "setup") return "准备中";
  if (game.phase === "firstNight") return "首夜";
  if (game.phase === "day") return `第 ${game.day} 天白天`;
  return `第 ${game.night} 夜`;
}

function nameOf(room, playerId) {
  return room.game.players.find((player) => player.id === playerId)?.name || "未知玩家";
}

function displayActor(room, id) {
  if (id === "storyteller") return "说书人";
  return nameOf(room, id);
}

function displayRecipient(room, value) {
  if (value === "public") return "公开广场";
  if (value === "storyteller") return "说书人";
  if (value?.startsWith("player:")) return nameOf(room, value.slice(7));
  if (value?.startsWith("room:")) return room.game.rooms.find((privateRoom) => privateRoom.id === value.slice(5))?.name || "私聊房";
  return value || "";
}

function log(room, type, text, scope = "host") {
  room.game.log.push({ id: crypto.randomUUID(), type, text, at: Date.now(), scope });
}

function isOwner(room, client) {
  return client.id === room.hostId;
}

function isStoryteller(room, client) {
  return isOwner(room, client) && room.game.storytellerMode === "human";
}

function makeRoomId(rooms) {
  let id = "";
  do {
    id = crypto.randomBytes(4).toString("base64url").replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase();
  } while (!id || rooms.has(id));
  return id;
}

function normalizeRoomId(value) {
  return cleanText(value, 12).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function httpError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { createRoomStore };
