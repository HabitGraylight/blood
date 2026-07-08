const { TEAM_LABELS, ALIGNMENT_LABELS, DEFAULT_SETUP, role: makeRole } = window.BLOOD_DATA;

const CLIENT_KEY = "blood-room-client-v2";
const USER_KEY = "blood-room-user-v1";
const TEAM_AVATAR_FALLBACKS = {
  townsfolk: { background: "#2f5f73", accent: "#8ed0e0" },
  outsider: { background: "#5f4b7a", accent: "#d7b8ff" },
  minion: { background: "#6f354f", accent: "#f0a0bd" },
  demon: { background: "#743126", accent: "#ffb09b" },
  traveler: { background: "#5f5832", accent: "#ecd77a" },
  fabled: { background: "#345f4a", accent: "#99dfba" },
  unknown: { background: "#2a2f3a", accent: "#8a93a3" }
};

const app = {
  roomId: "",
  clientId: "",
  token: "",
  user: null,
  state: null,
  source: null,
  selectedPlayerId: "",
  activeChatTab: "public",
  activeView: "lobby",
  publicView: false,
  draftScript: null
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  restoreUser();
  restoreClient();
  renderAll();
  verifyUser();
  autoJoinFromUrl();
});

function bindElements() {
  [
    "currentRoomInfo",
    "connectionState",
    "accountStatus",
    "usernameInput",
    "displayNameInput",
    "passwordInput",
    "loginBtn",
    "registerBtn",
    "logoutBtn",
    "authMessage",
    "roomNameInput",
    "createGameRoomBtn",
    "joinRoomCodeInput",
    "joinGameRoomBtn",
    "leaveRoomBtn",
    "roomShareLink",
    "copyRoomLinkBtn",
    "hostGuidePanel",
    "hostGuideTitle",
    "hostGuideMeta",
    "hostNextHint",
    "guideStepInvite",
    "guideStepDeal",
    "guideStepStart",
    "guideCopyLinkBtn",
    "fillFiveSeatsBtn",
    "guideAddAiBtn",
    "guideAutoBagBtn",
    "guideDealRolesBtn",
    "guideStartNightBtn",
    "scriptSelect",
    "humanModeBtn",
    "llmModeBtn",
    "llmConfig",
    "llmEndpoint",
    "llmPresetSelect",
    "llmModel",
    "copyLlmPromptBtn",
    "playerNames",
    "seatPlayersBtn",
    "addPlayerBtn",
    "aiPlayerNameInput",
    "aiPlayerPersonaInput",
    "aiPlayerProviderInput",
    "aiPlayerWisdomSelect",
    "addAiPlayerBtn",
    "playerCountBadge",
    "setupCounts",
    "roleBagSummary",
    "autoBagBtn",
    "dealRolesBtn",
    "clearRolesBtn",
    "openScriptEditorBtn",
    "exportScriptBtn",
    "importScriptInput",
    "exportStateBtn",
    "importStateInput",
    "resetAppBtn",
    "saveStatus",
    "phaseTitle",
    "startFirstNightBtn",
    "advancePhaseBtn",
    "runAiDayBtn",
    "resolveNightBtn",
    "publicViewBtn",
    "townCircle",
    "winCondition",
    "dayFlowStatus",
    "publicChatPreview",
    "playerSpeechText",
    "startDiscussionBtn",
    "continueAiStepBtn",
    "sendSpeechBtn",
    "skipSpeechBtn",
    "voteThreshold",
    "hostVoteTools",
    "playerVoteTools",
    "playerVoteTargetSelect",
    "castPlayerVoteBtn",
    "castAiVotesBtn",
    "resolveDayVotesBtn",
    "voteTally",
    "nominatorSelect",
    "nomineeSelect",
    "voteList",
    "recordVoteBtn",
    "executeLeaderBtn",
    "nominationLog",
    "nightKind",
    "nightOrderList",
    "llmNightBtn",
    "markNightDoneBtn",
    "selfRoleState",
    "selfCard",
    "selectedSeat",
    "selectedPlayerCard",
    "playerControls",
    "roleAssignSelect",
    "shownRoleSelect",
    "toggleAliveBtn",
    "togglePoisonBtn",
    "toggleDrunkBtn",
    "toggleVoteTokenBtn",
    "alignmentSelect",
    "reminderInput",
    "applyPlayerBtn",
    "addReminderBtn",
    "storyLog",
    "clearLogBtn",
    "storyLogSection",
    "playerControlSection",
    "llmToolsSection",
    "llmState",
    "llmInstruction",
    "llmOutput",
    "askLlmBtn",
    "summarizeChatBtn",
    "askSelectedAiBtn",
    "aiAutomationSection",
    "aiAutomationOutput",
    "runAiDaySideBtn",
    "resolveNightSideBtn",
    "chatMessages",
    "chatFromSelect",
    "chatToSelect",
    "chatText",
    "sendChatBtn",
    "createPrivateRoomBtn",
    "scriptEditor",
    "scriptNameInput",
    "scriptNoteInput",
    "saveScriptMetaBtn",
    "duplicateScriptBtn",
    "addRoleBtn",
    "roleEditorList"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll("[data-view-target]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.viewTarget));
  });
  els.loginBtn.addEventListener("click", loginUser);
  els.registerBtn.addEventListener("click", registerUser);
  els.logoutBtn.addEventListener("click", logoutUser);
  els.createGameRoomBtn.addEventListener("click", createGameRoom);
  els.joinGameRoomBtn.addEventListener("click", joinGameRoom);
  els.leaveRoomBtn.addEventListener("click", leaveRoom);
  els.copyRoomLinkBtn.addEventListener("click", () => copyText(els.roomShareLink.value));
  els.guideCopyLinkBtn.addEventListener("click", () => copyText(els.roomShareLink.value));
  els.fillFiveSeatsBtn.addEventListener("click", () => hostAction("fillSeats", { targetCount: 5 }));
  els.guideAddAiBtn.addEventListener("click", () => addAiPlayer(true));
  els.guideAutoBagBtn.addEventListener("click", () => hostAction("autoBag"));
  els.guideDealRolesBtn.addEventListener("click", () => hostAction("dealRoles"));
  els.guideStartNightBtn.addEventListener("click", () => hostAction("startFirstNight"));

  els.scriptSelect.addEventListener("change", () => hostAction("setScript", { scriptId: els.scriptSelect.value }));
  els.humanModeBtn.addEventListener("click", () => hostAction("setMode", { mode: "human" }));
  els.llmModeBtn.addEventListener("click", () => hostAction("setMode", { mode: "llm" }));
  els.llmEndpoint.addEventListener("change", syncLlmConfig);
  els.llmPresetSelect.addEventListener("change", syncLlmConfig);
  els.llmModel.addEventListener("change", syncLlmConfig);
  els.copyLlmPromptBtn.addEventListener("click", () => copyText(buildLlmPrompt("完整局势上下文")));

  els.seatPlayersBtn.addEventListener("click", () => {
    const names = els.playerNames.value
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);
    hostAction("renamePlayers", { names });
  });
  els.addPlayerBtn.addEventListener("click", () => hostAction("addSeat"));
  els.addAiPlayerBtn.addEventListener("click", () => addAiPlayer(false));
  els.autoBagBtn.addEventListener("click", () => hostAction("autoBag"));
  els.dealRolesBtn.addEventListener("click", () => hostAction("dealRoles"));
  els.clearRolesBtn.addEventListener("click", () => hostAction("clearRoles"));

  els.startFirstNightBtn.addEventListener("click", () => hostAction("startFirstNight"));
  els.advancePhaseBtn.addEventListener("click", () => hostAction("advancePhase"));
  els.runAiDayBtn.addEventListener("click", runAiDayRound);
  els.resolveNightBtn.addEventListener("click", resolveNight);
  els.runAiDaySideBtn.addEventListener("click", runAiDayRound);
  els.resolveNightSideBtn.addEventListener("click", resolveNight);
  els.startDiscussionBtn.addEventListener("click", async () => {
    await roomAction("startDayDiscussion");
    await refreshState();
  });
  els.continueAiStepBtn.addEventListener("click", runAiDayRound);
  els.sendSpeechBtn.addEventListener("click", sendPlayerSpeech);
  els.skipSpeechBtn.addEventListener("click", advanceMySpeech);
  els.castPlayerVoteBtn.addEventListener("click", castPlayerVote);
  els.castAiVotesBtn.addEventListener("click", async () => {
    await roomAction("castAiVotes");
    await refreshState();
  });
  els.resolveDayVotesBtn.addEventListener("click", async () => {
    await roomAction("resolveDayVotes");
    await refreshState();
    setView("game");
  });
  els.markNightDoneBtn.addEventListener("click", () => {
    if (isStoryteller()) hostAction("advancePhase");
    else resolveNight();
  });
  els.publicViewBtn.addEventListener("click", () => {
    app.publicView = !app.publicView;
    renderAll();
  });

  els.recordVoteBtn.addEventListener("click", recordVote);
  els.executeLeaderBtn.addEventListener("click", () => hostAction("executeLeader"));
  els.llmNightBtn.addEventListener("click", () => askLlm("请按当前夜晚顺序，给真人说书人一份今晚处理清单。"));

  els.roleAssignSelect.addEventListener("change", () => patchSelectedPlayer({ roleId: els.roleAssignSelect.value }));
  els.shownRoleSelect.addEventListener("change", () => patchSelectedPlayer({ shownRoleId: els.shownRoleSelect.value }));
  els.toggleAliveBtn.addEventListener("click", () => toggleSelected("alive"));
  els.togglePoisonBtn.addEventListener("click", () => toggleSelected("poisoned"));
  els.toggleDrunkBtn.addEventListener("click", () => toggleSelected("drunk"));
  els.toggleVoteTokenBtn.addEventListener("click", () => toggleSelected("ghostVote"));
  els.applyPlayerBtn.addEventListener("click", applySelectedPlayer);
  els.addReminderBtn.addEventListener("click", () => {
    if (!app.selectedPlayerId) return;
    hostAction("addReminder", { playerId: app.selectedPlayerId, text: els.reminderInput.value.trim() });
    els.reminderInput.value = "";
  });
  els.clearLogBtn.addEventListener("click", () => hostAction("importGame", { game: { ...game(), log: [] } }));

  els.askLlmBtn.addEventListener("click", () => askLlm(els.llmInstruction.value.trim() || "请给当前说书人下一步建议。"));
  els.summarizeChatBtn.addEventListener("click", () => askLlm("请总结目前公开发言和私聊中的关键矛盾、可信信息和可疑点。"));
  els.askSelectedAiBtn.addEventListener("click", askSelectedAiPlayer);

  document.querySelectorAll("[data-chat-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      app.activeChatTab = btn.dataset.chatTab;
      renderChat();
    });
  });
  els.sendChatBtn.addEventListener("click", sendChat);
  els.createPrivateRoomBtn.addEventListener("click", createPrivateRoomFromSelection);

  els.openScriptEditorBtn.addEventListener("click", openScriptEditor);
  els.exportScriptBtn.addEventListener("click", () => activeScript() && downloadJson(activeScript(), `${activeScript().id}.script.json`));
  els.importScriptInput.addEventListener("change", importScript);
  els.exportStateBtn.addEventListener("click", exportState);
  els.importStateInput.addEventListener("change", importState);
  els.resetAppBtn.addEventListener("click", resetRoom);
  els.saveScriptMetaBtn.addEventListener("click", saveDraftScript);
  els.duplicateScriptBtn.addEventListener("click", duplicateDraftScript);
  els.addRoleBtn.addEventListener("click", addRoleToDraft);
}

async function createGameRoom() {
  if (!requireUser()) return;
  const roomName = els.roomNameInput.value.trim() || "钟楼房间";
  const result = await postJson("/api/rooms", { roomName, auth: authPayload() });
  enterRoom(result);
}

async function joinGameRoom() {
  const roomId = normalizeRoomId(els.joinRoomCodeInput.value || getRoomFromUrl());
  if (!roomId) {
    showConnection("请输入房间码", false);
    return;
  }
  if (!requireUser()) return;
  const result = await postJson(`/api/rooms/${roomId}/join`, { auth: authPayload() });
  enterRoom(result);
}

function enterRoom(result) {
  app.roomId = result.roomId;
  app.clientId = result.clientId;
  app.token = result.token;
  app.state = result.state;
  saveClient();
  connectEvents();
  setView("setup");
  renderAll();
}

function leaveRoom() {
  if (app.source) app.source.close();
  app.roomId = "";
  app.clientId = "";
  app.token = "";
  app.state = null;
  app.selectedPlayerId = "";
  localStorage.removeItem(CLIENT_KEY);
  renderAll();
}

function restoreClient() {
  try {
    const saved = JSON.parse(localStorage.getItem(CLIENT_KEY) || "{}");
    if (saved.roomId && saved.clientId && saved.token) {
      app.roomId = saved.roomId;
      app.clientId = saved.clientId;
      app.token = saved.token;
      connectEvents();
    }
  } catch {
    localStorage.removeItem(CLIENT_KEY);
  }
}

function saveClient() {
  localStorage.setItem(
    CLIENT_KEY,
    JSON.stringify({ roomId: app.roomId, clientId: app.clientId, token: app.token })
  );
}

async function registerUser() {
  try {
    const result = await postJson("/api/auth/register", {
      username: els.usernameInput.value.trim(),
      password: els.passwordInput.value,
      displayName: els.displayNameInput.value.trim()
    });
    setUserSession(result);
    showAuthMessage("注册成功，已登录。");
  } catch (error) {
    showAuthMessage(error.message);
  }
}

async function loginUser() {
  try {
    const result = await postJson("/api/auth/login", {
      username: els.usernameInput.value.trim(),
      password: els.passwordInput.value
    });
    setUserSession(result);
    showAuthMessage("登录成功。");
  } catch (error) {
    showAuthMessage(error.message);
  }
}

async function logoutUser() {
  if (app.user) {
    await postJson("/api/auth/logout", {
      userId: app.user.id,
      sessionToken: app.user.sessionToken
    }).catch(() => {});
  }
  app.user = null;
  localStorage.removeItem(USER_KEY);
  leaveRoom();
  showAuthMessage("已退出登录。");
}

async function verifyUser() {
  if (!app.user?.id || !app.user?.sessionToken) return;
  try {
    const result = await getJson(
      `/api/auth/me?userId=${encodeURIComponent(app.user.id)}&sessionToken=${encodeURIComponent(app.user.sessionToken)}`
    );
    app.user = { ...result.user, sessionToken: app.user.sessionToken };
    saveUser();
    renderAll();
  } catch {
    app.user = null;
    localStorage.removeItem(USER_KEY);
    renderAll();
  }
}

function setUserSession(result) {
  app.user = { ...result.user, sessionToken: result.sessionToken };
  els.passwordInput.value = "";
  saveUser();
  renderAll();
}

function restoreUser() {
  try {
    const saved = JSON.parse(localStorage.getItem(USER_KEY) || "{}");
    if (saved.id && saved.sessionToken) app.user = saved;
  } catch {
    localStorage.removeItem(USER_KEY);
  }
}

function saveUser() {
  localStorage.setItem(USER_KEY, JSON.stringify(app.user));
}

function authPayload() {
  return { userId: app.user?.id || "", sessionToken: app.user?.sessionToken || "" };
}

function requireUser() {
  if (app.user) return true;
  showAuthMessage("请先登录或注册账号。");
  setView("lobby");
  return false;
}

function showAuthMessage(text) {
  els.authMessage.textContent = text;
}

function autoJoinFromUrl() {
  const roomId = getRoomFromUrl();
  if (roomId && !app.roomId) {
    els.joinRoomCodeInput.value = roomId;
  }
}

function connectEvents() {
  if (!app.roomId || !app.clientId || !app.token) return;
  if (app.source) app.source.close();
  showConnection("连接中", false);
  app.source = new EventSource(
    `/api/rooms/${app.roomId}/events?clientId=${encodeURIComponent(app.clientId)}&token=${encodeURIComponent(app.token)}`
  );
  app.source.onmessage = (event) => {
    app.state = JSON.parse(event.data);
    saveClient();
    if (!app.selectedPlayerId || !game().players.some((player) => player.id === app.selectedPlayerId)) {
      app.selectedPlayerId = game().players[0]?.id || "";
    }
    renderAll();
  };
  app.source.onerror = () => {
    showConnection("连接断开，正在重试", false);
  };
}

async function hostAction(type, payload = {}) {
  if (!hasRoom()) return;
  if (!isOwner()) {
    showConnection("只有房主可以操作", false);
    return;
  }
  await roomAction(type, payload);
  if (type === "startFirstNight" || type === "advancePhase") setView("game");
}

async function roomAction(type, payload = {}) {
  if (!hasRoom()) return;
  return postJson(`/api/rooms/${app.roomId}/actions`, {
    clientId: app.clientId,
    token: app.token,
    type,
    payload
  });
}

async function refreshState() {
  if (!hasRoom()) return;
  const result = await getJson(
    `/api/rooms/${app.roomId}?clientId=${encodeURIComponent(app.clientId)}&token=${encodeURIComponent(app.token)}`
  );
  app.state = result.state;
  renderAll();
}

function renderAll() {
  renderView();
  renderAccount();
  renderRoom();
  renderHostGuide();
  renderPermissions();
  renderScriptSelect();
  renderMode();
  renderPlayersTextarea();
  renderSetup();
  renderBoard();
  renderPhase();
  renderPublicDiscussion();
  renderSelectors();
  renderNominations();
  renderNightOrder();
  renderSelfCard();
  renderSelectedPlayer();
  renderLog();
  renderChat();
}

function setView(view) {
  app.activeView = ["lobby", "setup", "game", "chat"].includes(view) ? view : "lobby";
  renderView();
}

function renderView() {
  document.querySelector(".app-shell").dataset.view = app.activeView;
  document.querySelectorAll("[data-view-target]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.viewTarget === app.activeView);
  });
}

function renderAccount() {
  if (app.user) {
    els.accountStatus.textContent = `${app.user.displayName} · ${app.user.username}`;
    els.usernameInput.value = app.user.username;
    if (document.activeElement !== els.displayNameInput) els.displayNameInput.value = app.user.displayName;
    els.logoutBtn.disabled = false;
  } else {
    els.accountStatus.textContent = "未登录";
    els.logoutBtn.disabled = true;
  }
  els.createGameRoomBtn.disabled = !app.user;
  els.joinGameRoomBtn.disabled = !app.user;
}

function renderRoom() {
  const connected = hasRoom() && app.state;
  if (!connected) {
    els.currentRoomInfo.textContent = "未进入房间";
    els.roomShareLink.value = "";
    showConnection("离线", false);
    return;
  }
  const room = app.state.room;
  els.currentRoomInfo.textContent = `${room.name} · ${room.id} · ${room.playerCount} 人`;
  const url = new URL(window.location.href);
  url.searchParams.set("room", room.id);
  els.roomShareLink.value = url.toString();
  const label = isStoryteller() ? "真人说书人在线" : isOwner() ? "房主玩家在线" : "玩家在线";
  showConnection(label, true, isOwner());
}

function showConnection(text, online, host) {
  els.connectionState.textContent = text;
  els.connectionState.classList.toggle("online", Boolean(online));
  els.connectionState.classList.toggle("host", Boolean(host));
}

function renderPermissions() {
  const connected = hasRoom() && app.state;
  const owner = isOwner();
  const storyteller = isStoryteller();
  const ownerIds = [
    "scriptSelect",
    "humanModeBtn",
    "llmModeBtn",
    "llmEndpoint",
    "llmPresetSelect",
    "llmModel",
    "copyLlmPromptBtn",
    "playerNames",
    "seatPlayersBtn",
    "addPlayerBtn",
    "aiPlayerNameInput",
    "aiPlayerPersonaInput",
    "aiPlayerProviderInput",
    "aiPlayerWisdomSelect",
    "addAiPlayerBtn",
    "autoBagBtn",
    "dealRolesBtn",
    "clearRolesBtn",
    "openScriptEditorBtn",
    "exportScriptBtn",
    "importScriptInput",
    "exportStateBtn",
    "importStateInput",
    "resetAppBtn",
    "startFirstNightBtn",
    "advancePhaseBtn",
    "runAiDayBtn",
    "resolveNightBtn",
    "startDiscussionBtn",
    "continueAiStepBtn",
    "castAiVotesBtn",
    "resolveDayVotesBtn",
    "runAiDaySideBtn",
    "resolveNightSideBtn",
    "recordVoteBtn",
    "executeLeaderBtn",
    "markNightDoneBtn",
    "askSelectedAiBtn"
  ];
  const storytellerToolIds = ["llmNightBtn", "clearLogBtn", "askLlmBtn", "summarizeChatBtn"];
  const storytellerIds = [
    "roleAssignSelect",
    "shownRoleSelect",
    "toggleAliveBtn",
    "togglePoisonBtn",
    "toggleDrunkBtn",
    "toggleVoteTokenBtn",
    "alignmentSelect",
    "reminderInput",
    "applyPlayerBtn",
    "addReminderBtn"
  ];
  for (const id of ownerIds) {
    if (els[id]) els[id].disabled = !connected || !owner;
  }
  for (const id of storytellerToolIds) {
    if (els[id]) els[id].disabled = !connected || !storyteller;
  }
  for (const id of storytellerIds) {
    if (els[id]) els[id].disabled = !connected || !storyteller;
  }
  els.sendChatBtn.disabled = !connected;
  els.createPrivateRoomBtn.disabled = !connected;
  els.guideCopyLinkBtn.disabled = !connected;
  els.fillFiveSeatsBtn.disabled = !connected || !owner;
  els.guideAddAiBtn.disabled = !connected || !owner;
  els.guideAutoBagBtn.disabled = !connected || !owner;
  els.guideDealRolesBtn.disabled = !connected || !owner;
  els.guideStartNightBtn.disabled = !connected || !owner;
  els.askSelectedAiBtn.disabled = !connected || !owner || !selectedPlayer()?.ai;
  els.runAiDayBtn.disabled = !connected || !owner || game().phase !== "day";
  els.runAiDaySideBtn.disabled = els.runAiDayBtn.disabled;
  els.resolveNightBtn.disabled = !connected || !owner || (game().phase !== "firstNight" && game().phase !== "night");
  els.resolveNightSideBtn.disabled = els.resolveNightBtn.disabled;
  if (connected && owner && !storyteller && (game().phase === "firstNight" || game().phase === "night")) {
    els.advancePhaseBtn.disabled = true;
  }
  els.llmToolsSection.classList.toggle("hidden", connected && !storyteller);
  els.storyLogSection.classList.toggle("hidden", connected && !storyteller);
  els.playerControlSection.classList.toggle("hidden", connected && !storyteller);
  els.aiAutomationSection.classList.toggle("hidden", !connected || !owner);
  els.llmNightBtn.classList.toggle("hidden", connected && !storyteller);
  document.querySelector(".setup-panel").classList.toggle("readonly", connected && !storyteller);
  document.querySelector(".control-panel").classList.toggle("readonly", connected && !storyteller);
}

function renderHostGuide() {
  if (!hasRoom() || !app.state) {
    els.hostGuideTitle.textContent = "先创建或加入房间";
    els.hostGuideMeta.textContent = "等待中";
    els.hostNextHint.textContent = "创建房间后，房主会在这里看到清晰的开局步骤。";
    setGuideStep("invite");
    return;
  }

  const playerCount = game().players.length;
  const bagCount = selectedBagCount();
  const dealtCount = game().players.filter((player) => player.shownRoleId || player.roleId).length;
  const owner = isOwner();

  els.hostGuideTitle.textContent = owner
    ? isStoryteller()
      ? "真人说书人准备流程"
      : "房主玩家准备流程"
    : "玩家等待区";
  els.hostGuideMeta.textContent = `${playerCount} 人 · ${phaseLabel()}`;

  if (!owner) {
    els.hostNextHint.textContent =
      myPlayer()?.shownRoleId || myPlayer()?.roleId
        ? "你已经拿到身份。等待说书人推进夜晚或白天，也可以使用下方公开/私聊记录。"
        : "你已进入房间。等待房主邀请其他玩家并发牌；你不会看到其他人的隐藏身份。";
    setGuideStep("invite");
    return;
  }

  if (playerCount < 5) {
    els.hostNextHint.textContent = `当前只有 ${playerCount} 人。复制邀请链接给玩家；如果只是调试，点“补到 5 人测试”。`;
    setGuideStep("invite");
    return;
  }

  if (bagCount !== playerCount) {
    els.hostNextHint.textContent = `人数已够。下一步点“自动抽角色”，让发牌袋数量等于玩家数。当前发牌袋 ${bagCount}/${playerCount}。`;
    setGuideStep("deal");
    return;
  }

  if (dealtCount < playerCount) {
    els.hostNextHint.textContent = "发牌袋已准备好。下一步点“随机发牌”，普通玩家会只看到自己的身份。";
    setGuideStep("deal");
    return;
  }

  if (game().phase === "setup") {
    els.hostNextHint.textContent = "身份已发完。下一步点“开始首夜”，然后按夜晚顺序主持。";
    setGuideStep("start");
    return;
  }

  els.hostNextHint.textContent = isStoryteller()
    ? "游戏已开始。使用魔典、夜晚顺序、聊天和提名投票区域继续主持。"
    : "游戏已开始。你是玩家视角；隐藏信息交给 LLM 说书人，房主只负责必要的公开流程按钮。";
  setGuideStep("start", true);
}

function setGuideStep(active, allDone = false) {
  const map = {
    invite: els.guideStepInvite,
    deal: els.guideStepDeal,
    start: els.guideStepStart
  };
  for (const [key, node] of Object.entries(map)) {
    node.classList.toggle("active", key === active && !allDone);
    node.classList.toggle("done", allDone || stepBefore(key, active));
  }
}

function stepBefore(key, active) {
  const order = ["invite", "deal", "start"];
  return order.indexOf(key) < order.indexOf(active);
}

function renderScriptSelect() {
  els.scriptSelect.innerHTML = "";
  for (const script of game().scripts) {
    const option = document.createElement("option");
    option.value = script.id;
    option.textContent = script.name;
    option.selected = script.id === game().activeScriptId;
    els.scriptSelect.append(option);
  }
}

function renderMode() {
  const isLlm = game().storytellerMode === "llm";
  els.humanModeBtn.classList.toggle("active", !isLlm);
  els.llmModeBtn.classList.toggle("active", isLlm);
  els.llmConfig.classList.toggle("hidden", !isLlm || !isOwner());
  if (document.activeElement !== els.llmEndpoint) els.llmEndpoint.value = game().llm?.providerId || "";
  if (document.activeElement !== els.llmPresetSelect) els.llmPresetSelect.value = game().llm?.presetId || "pro-reasoning";
  if (document.activeElement !== els.llmModel) els.llmModel.value = game().llm?.model || "";
  els.llmState.textContent = isLlm ? "已启用" : "真人模式";
}

function renderPlayersTextarea() {
  const names = game().players.map((player) => player.name).join("\n");
  if (document.activeElement !== els.playerNames) els.playerNames.value = names;
  els.playerCountBadge.textContent = `${game().players.length} 人`;
}

function renderSetup() {
  const counts = getSetupCounts();
  els.setupCounts.textContent = counts ? formatCounts(counts) : "5-15 人";
  els.roleBagSummary.innerHTML = "";
  if (!isStoryteller()) {
    const ownerCopy = isOwner()
      ? `LLM 说书人模式下，房主是玩家。发牌袋角色明细隐藏；当前发牌袋 ${selectedBagCount()}/${game().players.length}。`
      : "发牌袋仅真人说书人可见。";
    els.roleBagSummary.innerHTML = `<div class="log-entry">${escapeHtml(ownerCopy)}</div>`;
    return;
  }
  const bagCounts = countBag(game().selectedBag);
  for (const team of ["townsfolk", "outsider", "minion", "demon"]) {
    const wrapper = document.createElement("div");
    const teamRoles = activeScript().roles.filter((item) => item.team === team);
    const title = document.createElement("div");
    title.className = "bag-row";
    title.innerHTML = `<span class="bag-count">${bagCounts[team] || 0}</span><div><strong>${TEAM_LABELS[team]}</strong><br><small>${teamRoles.length} 种角色</small></div><span></span>`;
    wrapper.append(title);
    for (const item of teamRoles) {
      const selectedCount = game().selectedBag.filter((roleId) => roleId === item.id).length;
      const row = document.createElement("div");
      row.className = "bag-row";
      row.innerHTML = `
        <span class="bag-count">${selectedCount}</span>
        <div class="role-bag-identity">
          ${roleAvatarHtml(item, "small")}
          <div><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.ability)}</small></div>
        </div>
        <div class="mini-buttons">
          <button type="button" data-bag-minus="${item.id}">-</button>
          <button type="button" data-bag-plus="${item.id}">+</button>
        </div>
      `;
      wrapper.append(row);
    }
    els.roleBagSummary.append(wrapper);
  }
  els.roleBagSummary.querySelectorAll("[data-bag-plus]").forEach((btn) => {
    btn.addEventListener("click", () => hostAction("bagPlus", { roleId: btn.dataset.bagPlus }));
  });
  els.roleBagSummary.querySelectorAll("[data-bag-minus]").forEach((btn) => {
    btn.addEventListener("click", () => hostAction("bagMinus", { roleId: btn.dataset.bagMinus }));
  });
}

function renderBoard() {
  els.townCircle.innerHTML = "";
  const players = game().players;
  const count = Math.max(players.length, 1);
  players.forEach((player, index) => {
    const angle = -90 + (360 / count) * index;
    const spread = window.innerWidth <= 880 ? 36 : 39;
    const x = 50 + Math.cos((angle * Math.PI) / 180) * spread;
    const y = 50 + Math.sin((angle * Math.PI) / 180) * spread;
    const token = document.createElement("button");
    token.type = "button";
    token.className = [
      "player-token",
      player.id === app.selectedPlayerId ? "selected" : "",
      player.alignment && (isStoryteller() || player.id === me().playerId) ? player.alignment : "",
      player.alive ? "" : "dead"
    ]
      .filter(Boolean)
      .join(" ");
    token.style.setProperty("--x", `${x}%`);
    token.style.setProperty("--y", `${y}%`);
    token.addEventListener("click", () => {
      app.selectedPlayerId = player.id;
      renderAll();
    });

    const actualRole = roleById(player.roleId);
    const shownRole = roleById(player.shownRoleId || player.roleId);
    const isSelf = player.id === me().playerId;
    let roleText = "角色隐藏";
    let visibleRole = null;
    if (isStoryteller() && !app.publicView) {
      roleText = actualRole
        ? `${actualRole.name}${shownRole && shownRole.id !== actualRole.id ? ` / 显示 ${shownRole.name}` : ""}`
        : "未发牌";
      visibleRole = actualRole;
    } else if (isSelf && shownRole) {
      roleText = `你的角色：${shownRole.name}`;
      visibleRole = shownRole;
    } else if (isStoryteller() && app.publicView) {
      roleText = shownRole?.name || "未发牌";
      visibleRole = shownRole;
    }
    const stateText = isSelf && player.alignment ? `${ALIGNMENT_LABELS[player.alignment]} - ` : "";
    token.innerHTML = `
      <div class="player-main">
        <div class="player-name">${escapeHtml(player.name)}</div>
        <span class="seat-number">${index + 1}</span>
      </div>
      <div class="player-role-strip">
        ${roleAvatarHtml(visibleRole, visibleRole ? "token" : "token hidden-role")}
        <div class="role-line">${escapeHtml(roleText)}</div>
      </div>
      <div class="state-line">${stateText}${player.alive ? "存活" : "死亡"}${player.ai ? " · AI" : ""}</div>
      <div class="badge-row">${badgesForPlayer(player).map((badge) => `<span class="badge ${badge.color || ""}">${escapeHtml(badge.text)}</span>`).join("")}</div>
    `;
    els.townCircle.append(token);
  });
  els.winCondition.textContent = evaluateWinCondition();
}

function renderPhase() {
  els.phaseTitle.textContent = phaseLabel();
  els.publicViewBtn.classList.toggle("active", app.publicView);
  els.publicViewBtn.textContent = app.publicView ? "公开视角已开" : "公开视角";
}

function renderPublicDiscussion() {
  const flow = dayFlow();
  const speaker = currentDaySpeaker();
  if (game().phase !== "day") {
    els.dayFlowStatus.textContent = game().phase === "setup" ? "等待开局" : "夜晚中";
  } else if (flow.status === "speaking") {
    els.dayFlowStatus.textContent = `当前发言：${speaker?.name || "未知玩家"}`;
  } else if (flow.status === "voting") {
    els.dayFlowStatus.textContent = "投票中";
  } else if (flow.status === "complete") {
    els.dayFlowStatus.textContent = "白天已结算";
  } else {
    els.dayFlowStatus.textContent = "等待公开发言";
  }

  const publicMessages = game()
    .chats.filter((message) => message.kind === "public")
    .slice(-8);
  els.publicChatPreview.innerHTML =
    publicMessages
      .map(
        (message) => `
          <article class="public-chat-line ${message.from === me().playerId ? "mine" : ""}">
            <strong>${escapeHtml(displayActor(message.from))}</strong>
            <p>${escapeHtml(message.text)}</p>
          </article>
        `
      )
      .join("") || `<div class="public-chat-line empty">公开频道暂无发言。</div>`;
  renderDayFlowControls();
}

function renderDayFlowControls() {
  const connected = hasRoom() && app.state;
  const flow = dayFlow();
  const speaker = currentDaySpeaker();
  const player = myPlayer();
  const phaseIsDay = game().phase === "day";
  const myTurn = phaseIsDay && flow.status === "speaking" && speaker?.id === me().playerId;
  const canVote = phaseIsDay && flow.status === "voting" && player && (player.alive || player.ghostVote);
  const ownerCanContinue =
    connected &&
    isOwner() &&
    phaseIsDay &&
    (flow.status === "idle" ||
      flow.status === "complete" ||
      flow.status === "voting" ||
      (flow.status === "speaking" && Boolean(speaker?.ai)));

  els.startDiscussionBtn.classList.toggle("hidden", !isOwner());
  els.continueAiStepBtn.classList.toggle("hidden", !isOwner());
  els.startDiscussionBtn.disabled =
    !connected || !isOwner() || !phaseIsDay || !["idle", "complete"].includes(flow.status);
  els.continueAiStepBtn.disabled = !ownerCanContinue;
  els.continueAiStepBtn.textContent =
    flow.status === "voting"
      ? "让 AI 投票"
      : flow.status === "speaking" && speaker?.ai
        ? `推进 ${speaker.name}`
        : "继续 AI 发言";

  els.playerSpeechText.disabled = !myTurn;
  els.sendSpeechBtn.disabled = !myTurn;
  els.skipSpeechBtn.disabled = !myTurn;
  els.sendSpeechBtn.textContent = myTurn ? "发表并结束我的发言" : "等待轮到我";

  els.playerVoteTargetSelect.disabled = !canVote;
  els.castPlayerVoteBtn.disabled = !canVote || !els.playerVoteTargetSelect.value;
  els.castAiVotesBtn.classList.toggle("hidden", !isOwner());
  els.resolveDayVotesBtn.classList.toggle("hidden", !isOwner());
  els.castAiVotesBtn.disabled = !connected || !isOwner() || !phaseIsDay || flow.status !== "voting";
  els.resolveDayVotesBtn.disabled = els.castAiVotesBtn.disabled;
}

function renderSelectors() {
  const playerOptions = game().players
    .map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`)
    .join("");
  els.nominatorSelect.innerHTML = playerOptions;
  els.nomineeSelect.innerHTML = playerOptions;

  const roleOptions = [
    `<option value="">未发牌</option>`,
    ...activeScript().roles.map(
      (item) => `<option value="${item.id}">${escapeHtml(item.name)} - ${TEAM_LABELS[item.team]}</option>`
    )
  ].join("");
  els.roleAssignSelect.innerHTML = roleOptions;
  els.shownRoleSelect.innerHTML = roleOptions;

  const fromOptions = isStoryteller()
    ? [
        `<option value="storyteller">说书人</option>`,
        ...game().players.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`)
      ]
    : [`<option value="${me().playerId}">${escapeHtml(myPlayer()?.name || me().name || "我")}</option>`];
  els.chatFromSelect.innerHTML = fromOptions.join("");
  renderChatRecipients();
}

function renderChatRecipients() {
  const roomOptions = game().rooms.map(
    (room) => `<option value="room:${room.id}">${escapeHtml(room.name)}</option>`
  );
  const playerOptions = game().players
    .filter((player) => isStoryteller() || player.id !== me().playerId)
    .map((player) => `<option value="player:${player.id}">私信 ${escapeHtml(player.name)}</option>`);
  els.chatToSelect.innerHTML = [
    `<option value="public">公开广场</option>`,
    `<option value="storyteller">说书人私信</option>`,
    ...roomOptions,
    ...playerOptions
  ].join("");
}

function renderNominations() {
  const aliveCount = game().players.filter((player) => player.alive).length;
  const threshold = Math.ceil(aliveCount / 2);
  els.voteThreshold.textContent = aliveCount ? `处决门槛 ${threshold}` : "门槛 -";

  const currentTarget = els.playerVoteTargetSelect.value;
  const targets = game().players.filter((player) => player.alive && player.id !== me().playerId);
  const targetOptions = (targets.length ? targets : game().players.filter((player) => player.alive))
    .map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`)
    .join("");
  els.playerVoteTargetSelect.innerHTML = targetOptions || `<option value="">无可投票目标</option>`;
  if (targets.some((player) => player.id === currentTarget)) els.playerVoteTargetSelect.value = currentTarget;

  els.hostVoteTools.classList.toggle("hidden", !isStoryteller());
  els.playerVoteTools.classList.toggle("hidden", isStoryteller());

  els.voteList.innerHTML = "";
  for (const player of game().players) {
    const row = document.createElement("div");
    row.className = "vote-row";
    const disabled = !isOwner() || (!player.alive && !player.ghostVote);
    row.innerHTML = `
      <label>
        <input type="checkbox" data-voter="${player.id}" ${disabled ? "disabled" : ""} />
        ${escapeHtml(player.name)}
      </label>
      <span>${player.alive ? "活人票" : player.ghostVote ? "死票" : "已无票"}</span>
    `;
    els.voteList.append(row);
  }
  renderVoteTally(threshold);
  els.nominationLog.innerHTML = game()
    .nominations.slice()
    .reverse()
    .map(
      (item) =>
        `<div class="log-entry"><strong>${escapeHtml(nameOf(item.nomineeId))}</strong> 获 ${item.votes.length} 票 <time>${escapeHtml(item.phaseLabel)}</time></div>`
    )
    .join("");
  renderDayFlowControls();
}

function renderVoteTally(threshold) {
  const flow = dayFlow();
  const votes = Array.isArray(flow.votes) ? flow.votes : [];
  const myVote = votes.find((vote) => vote.voterId === me().playerId);
  const groups = new Map();
  for (const vote of votes) {
    if (!groups.has(vote.targetId)) groups.set(vote.targetId, []);
    groups.get(vote.targetId).push(vote.voterId);
  }
  const rows = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([targetId, voterIds]) => {
      const voters = voterIds.map(nameOf).join("、");
      return `
        <div class="tally-row">
          <strong>${escapeHtml(nameOf(targetId))}</strong>
          <span>${voterIds.length}/${threshold || "-"} 票</span>
          <small>${escapeHtml(voters || "暂无")}</small>
        </div>
      `;
    })
    .join("");
  const selfLine = myVote ? `你已投给 ${nameOf(myVote.targetId)}。` : "你尚未投票。";
  const phaseLine =
    game().phase === "day" && flow.status === "voting"
      ? selfLine
      : flow.status === "speaking"
        ? "公开发言结束后进入投票。"
        : "进入白天投票后会显示计票。";
  els.voteTally.innerHTML = `
    <div class="vote-status">${escapeHtml(phaseLine)}</div>
    ${rows || `<div class="tally-row empty">暂无票数。</div>`}
  `;
}

function renderNightOrder() {
  const isFirst = game().phase === "firstNight" || game().night <= 1;
  els.nightKind.textContent = isFirst ? "首夜" : "其他夜";
  els.markNightDoneBtn.textContent = isStoryteller() ? "本夜结束" : "结算本夜";
  const order = activeScript().nightOrder?.[isFirst ? "first" : "other"] || [];
  const inPlay = new Set(game().players.map((player) => player.roleId || player.shownRoleId).filter(Boolean));
  els.nightOrderList.innerHTML = "";
  for (const roleId of order) {
    const item = roleById(roleId);
    if (!item) continue;
    const actors = isStoryteller()
      ? game()
          .players.filter((player) => player.roleId === roleId)
          .map((player) => player.name)
      : [];
    const node = document.createElement("div");
    node.className = `night-item ${inPlay.has(roleId) ? "active" : ""}`;
    node.innerHTML = `
      <strong class="night-role-heading">${roleAvatarHtml(item, "small")}<span>${escapeHtml(item.name)} ${actors.length ? `- ${actors.map(escapeHtml).join(", ")}` : ""}</span></strong>
      <span class="ability">${escapeHtml(item.ability)}</span>
    `;
    els.nightOrderList.append(node);
  }
}

function renderSelfCard() {
  const player = myPlayer();
  if (!hasRoom() || !player) {
    els.selfRoleState.textContent = "未入房";
    els.selfCard.className = "selected-card empty";
    els.selfCard.textContent = "创建或加入房间后显示。";
    return;
  }
  const shownRole = roleById(player.shownRoleId || player.roleId);
  els.selfRoleState.textContent = isStoryteller() ? "真人说书人" : isOwner() ? "房主玩家" : "玩家";
  els.selfCard.className = "selected-card";
  els.selfCard.innerHTML = `
    <div class="role-card-heading">
      ${roleAvatarHtml(shownRole, shownRole ? "large" : "large hidden-role")}
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <span>${escapeHtml(shownRole?.name || "待发牌")}</span>
      </div>
    </div>
    <span>阵营：${escapeHtml(ALIGNMENT_LABELS[player.alignment] || "待发牌")}</span>
    <span>${escapeHtml(shownRole?.ability || "等待说书人发牌。")}</span>
    <div class="badge-row">
      <span class="badge ${player.alive ? "green" : "red"}">${player.alive ? "存活" : "死亡"}</span>
      ${!player.alive ? `<span class="badge">${player.ghostVote ? "死票可用" : "死票已用"}</span>` : ""}
    </div>
  `;
}

function renderSelectedPlayer() {
  const player = selectedPlayer();
  els.playerControls.classList.toggle("hidden", !player || !isStoryteller());
  if (!player) {
    els.selectedSeat.textContent = "未选择";
    els.selectedPlayerCard.className = "selected-card empty";
    els.selectedPlayerCard.textContent = "点击城镇广场中的玩家。";
    return;
  }

  const actualRole = roleById(player.roleId);
  const shownRole = roleById(player.shownRoleId || player.roleId);
  const index = game().players.findIndex((item) => item.id === player.id);
  els.selectedSeat.textContent = `座位 ${index + 1}`;
  els.selectedPlayerCard.className = "selected-card";
  if (!isStoryteller()) {
    const playerVisibleRole = player.id === me().playerId ? shownRole : null;
    els.selectedPlayerCard.innerHTML = `
      <div class="role-card-heading">
        ${roleAvatarHtml(playerVisibleRole, playerVisibleRole ? "large" : "large hidden-role")}
        <div>
          <strong>${escapeHtml(player.name)}</strong>
          <span>${player.id === me().playerId ? escapeHtml(shownRole?.name || "待发牌") : "角色隐藏"}</span>
        </div>
      </div>
      <span>${player.alive ? "存活" : "死亡"}</span>
      ${player.ai ? `<span>AI：${escapeHtml(player.aiProfile?.persona || "未设置性格")}</span>` : ""}
    `;
    return;
  }
  els.selectedPlayerCard.innerHTML = `
    <div class="role-card-heading">
      ${roleAvatarHtml(actualRole, actualRole ? "large" : "large hidden-role")}
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <span>${escapeHtml(actualRole?.name || "未发牌")}</span>
      </div>
    </div>
    <span>${ALIGNMENT_LABELS[player.alignment]} - ${player.alive ? "存活" : "死亡"}</span>
    ${player.ai ? `<span>AI：${escapeHtml(player.aiProfile?.persona || "未设置性格")}</span>` : ""}
    <span>玩家看到：${roleAvatarHtml(shownRole, shownRole ? "inline" : "inline hidden-role")} ${escapeHtml(shownRole?.name || "未发牌")}</span>
    <div class="badge-row">${(player.reminders || []).map((item) => `<span class="badge green">${escapeHtml(item)}</span>`).join("")}</div>
  `;
  els.roleAssignSelect.value = player.roleId || "";
  els.shownRoleSelect.value = player.shownRoleId || player.roleId || "";
  els.alignmentSelect.value = player.alignment || "good";
  els.toggleAliveBtn.textContent = player.alive ? "标记死亡" : "复活";
  els.togglePoisonBtn.textContent = player.poisoned ? "解除中毒" : "标记中毒";
  els.toggleDrunkBtn.textContent = player.drunk ? "解除醉酒" : "标记醉酒";
  els.toggleVoteTokenBtn.textContent = player.ghostVote ? "消耗死票" : "恢复死票";
}

function renderLog() {
  els.storyLog.innerHTML =
    game()
      .log.slice()
      .reverse()
      .map(
        (entry) =>
          `<div class="log-entry"><strong>${escapeHtml(entry.type)}</strong><br>${escapeHtml(entry.text)}<br><time>${new Date(entry.at).toLocaleString()}</time></div>`
      )
      .join("") || `<div class="log-entry">暂无日志。</div>`;
}

function renderChat() {
  document.querySelectorAll("[data-chat-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.chatTab === app.activeChatTab);
  });
  renderChatRecipients();
  const filtered = game().chats.filter((message) => message.kind === app.activeChatTab);
  els.chatMessages.innerHTML =
    filtered
      .map(
        (message) => `
        <article class="chat-message ${message.kind}">
          <strong>${escapeHtml(displayActor(message.from))} -> ${escapeHtml(displayRecipient(message.to))}</strong>
          <p>${escapeHtml(message.text)}</p>
          <time>${new Date(message.at).toLocaleString()}</time>
        </article>
      `
      )
      .join("") || `<div class="chat-message ${app.activeChatTab}">暂无记录。</div>`;
}

function syncLlmConfig() {
  if (!isOwner()) return;
  hostAction("setLlm", {
    providerId: els.llmEndpoint.value.trim(),
    presetId: els.llmPresetSelect.value,
    model: els.llmModel.value.trim()
  });
}

function addAiPlayer(useDefault) {
  const name = useDefault ? "" : els.aiPlayerNameInput.value.trim();
  const persona = useDefault ? "" : els.aiPlayerPersonaInput.value.trim();
  const providerId = useDefault ? "" : els.aiPlayerProviderInput.value.trim();
  const presetId = useDefault ? "flash" : els.aiPlayerWisdomSelect.value;
  hostAction("addAiPlayer", { name, persona, providerId, presetId, model: els.llmModel.value.trim() });
  if (!useDefault) {
    els.aiPlayerNameInput.value = "";
    els.aiPlayerPersonaInput.value = "";
    els.aiPlayerProviderInput.value = "";
  }
}

function recordVote() {
  const votes = [...els.voteList.querySelectorAll("input[data-voter]:checked")].map((input) => input.dataset.voter);
  hostAction("recordVote", {
    nominatorId: els.nominatorSelect.value,
    nomineeId: els.nomineeSelect.value,
    votes
  });
}

function toggleSelected(field) {
  const player = selectedPlayer();
  if (!player) return;
  patchSelectedPlayer({ [field]: !player[field] });
}

function applySelectedPlayer() {
  const player = selectedPlayer();
  if (!player) return;
  patchSelectedPlayer({
    roleId: els.roleAssignSelect.value,
    shownRoleId: els.shownRoleSelect.value || els.roleAssignSelect.value,
    alignment: els.alignmentSelect.value
  });
}

function patchSelectedPlayer(patch) {
  if (!app.selectedPlayerId) return;
  hostAction("updatePlayer", { playerId: app.selectedPlayerId, patch });
}

function sendChat() {
  const text = els.chatText.value.trim();
  if (!text) return;
  roomAction("sendChat", {
    from: els.chatFromSelect.value,
    to: els.chatToSelect.value,
    text
  });
  els.chatText.value = "";
}

async function sendPlayerSpeech() {
  if (!isMySpeechTurn()) {
    showConnection("现在还没有轮到你发言", false);
    return;
  }
  const text = els.playerSpeechText.value.trim();
  if (text) {
    await roomAction("sendChat", {
      from: me().playerId,
      to: "public",
      text
    });
  }
  await roomAction("advanceDaySpeaker");
  els.playerSpeechText.value = "";
  await refreshState();
  if (isOwner()) await runAiDayRound();
}

async function advanceMySpeech() {
  if (!isMySpeechTurn()) {
    showConnection("现在还没有轮到你发言", false);
    return;
  }
  await roomAction("advanceDaySpeaker");
  els.playerSpeechText.value = "";
  await refreshState();
  if (isOwner()) await runAiDayRound();
}

async function castPlayerVote() {
  const targetId = els.playerVoteTargetSelect.value;
  if (!targetId) {
    showConnection("请选择投票对象", false);
    return;
  }
  await roomAction("castVote", { targetId });
  await refreshState();
  showConnection(`已投给 ${nameOf(targetId)}`, true, isOwner());
}

function createPrivateRoomFromSelection() {
  const members = [app.selectedPlayerId, me().playerId].filter(Boolean);
  roomAction("createPrivateRoom", { memberIds: [...new Set(members)] });
}

async function askLlm(instruction) {
  if (!isOwner()) return;
  try {
    const result = await requestRoomLlm({
      kind: "storyteller-advice",
      instruction,
      providerId: els.llmEndpoint.value.trim(),
      presetId: els.llmPresetSelect.value,
      model: els.llmModel.value.trim()
    });
    if (result.promptOnly) {
      await copyText(result.prompt);
      showLlmOutput("Provider 未完整配置，已复制说书人提示词。");
      return;
    }
    showLlmOutput(result.text || "LLM 返回为空。");
  } catch (error) {
    showLlmOutput(`LLM 请求失败：${error.message}`);
  }
}

async function askSelectedAiPlayer() {
  const player = selectedPlayer();
  if (!isOwner() || !player?.ai) {
    showConnection("请先选中一个 AI 玩家", false);
    return;
  }
  try {
    const result = await requestRoomLlm({
      kind: "ai-public-chat",
      playerId: player.id,
      instruction: els.llmInstruction.value.trim() || "请根据当前公开局势发言。",
      providerId: els.llmEndpoint.value.trim(),
      presetId: els.llmPresetSelect.value,
      model: els.llmModel.value.trim()
    });
    if (result.promptOnly) {
      await copyText(result.prompt);
      showConnection("LLM 未配置，已复制 AI 玩家提示词", false);
      showLlmOutput("Provider 未完整配置，已复制 AI 玩家提示词。");
      return;
    }
    if (!result.text?.trim()) {
      showLlmOutput("AI 玩家模型返回为空。");
      return;
    }
    await roomAction("sendAiChat", { playerId: player.id, to: "public", text: result.text.trim() });
    showLlmOutput(`${player.name}: ${result.text.trim()}`);
  } catch (error) {
    showLlmOutput(`AI 玩家发言失败：${error.message}`);
  }
}

async function runAiDayRound() {
  if (!isOwner() || game().phase !== "day") {
    showAiAutomation("当前不是白天，不能推进 AI 白天流程。");
    return;
  }
  if (["idle", "complete"].includes(dayFlow().status)) {
    await roomAction("startDayDiscussion");
    await refreshState();
    showAiAutomation(`公开讨论已开始，当前发言：${currentDaySpeaker()?.name || "未知玩家"}。`);
    setView("game");
    return;
  }

  if (dayFlow().status === "speaking") {
    const player = currentDaySpeaker();
    if (!player) {
      await roomAction("advanceDaySpeaker");
      await refreshState();
      showAiAutomation("公开发言已推进。");
      return;
    }
    if (!player.ai) {
      showAiAutomation(`轮到 ${player.name} 发言，AI 推进已暂停，等待真人玩家发表或跳过。`);
      return;
    }

    try {
      const result = await requestRoomLlm({
        kind: "ai-public-chat",
        playerId: player.id,
        instruction:
          "请阅读当前公开发言、投票和存活状态，作为玩家给出一段白天公开发言。可以怀疑、回应、拉票或防守，但不要自曝隐藏信息。",
        providerId: els.llmEndpoint.value.trim(),
        presetId: player.aiProfile?.presetId || els.aiPlayerWisdomSelect.value || "flash",
        model: player.aiProfile?.model || ""
      });
      const text = result.promptOnly
        ? `${player.name}：我会先根据公开发言观察票型，暂时不把话说死。`
        : String(result.text || "").trim();
      if (text) await roomAction("sendAiChat", { playerId: player.id, to: "public", text });
    } catch (error) {
      await roomAction("sendAiChat", {
        playerId: player.id,
        to: "public",
        text: "我先根据公开信息保留意见，等投票看票型。"
      });
      showAiAutomation(`${player.name} 发言失败，已使用保底发言：${error.message}`);
    }
    await roomAction("advanceDaySpeaker");
    await refreshState();
    const next = currentDaySpeaker();
    if (dayFlow().status === "voting") {
      showAiAutomation("公开发言结束，进入投票。请真人玩家先投票，或由房主让 AI 投票。");
    } else {
      showAiAutomation(next?.ai ? `${player.name} 已发言。下一位 AI：${next.name}。` : `${player.name} 已发言。轮到 ${next?.name || "真人玩家"}。`);
    }
    setView("game");
    return;
  }

  if (game().phase === "day" && dayFlow().status === "voting") {
    await roomAction("castAiVotes", {});
    await refreshState();
    showAiAutomation("AI 已完成投票。等待真人玩家投票；房主确认后再结算投票并入夜。");
    return;
  }

  setView("game");
  showAiAutomation("AI 白天推进已暂停。");
}

async function resolveNight() {
  if (!isOwner()) return;
  if (game().phase !== "firstNight" && game().phase !== "night") {
    showAiAutomation("当前不是夜晚。");
    return;
  }
  await roomAction("resolveNight", {});
  setView("game");
  showAiAutomation("夜晚行动已结算，并进入白天。");
}

function showAiAutomation(text) {
  if (els.aiAutomationOutput) els.aiAutomationOutput.textContent = text;
  showConnection(text, hasRoom());
}

async function requestRoomLlm(payload) {
  return postJson(`/api/rooms/${app.roomId}/llm`, {
    clientId: app.clientId,
    token: app.token,
    ...payload
  });
}

function buildLlmPrompt(instruction) {
  return JSON.stringify({ instruction, room: app.state?.room, me: app.state?.me, visibleGame: game() }, null, 2);
}

function showLlmOutput(text) {
  els.llmOutput.textContent = text || "";
}

function openScriptEditor() {
  if (!isOwner()) return;
  app.draftScript = deepClone(activeScript());
  els.scriptNameInput.value = app.draftScript.name;
  els.scriptNoteInput.value = app.draftScript.note || "";
  renderRoleEditor();
  els.scriptEditor.showModal();
}

function renderRoleEditor() {
  const template = document.getElementById("roleEditorTemplate");
  els.roleEditorList.innerHTML = "";
  if (!app.draftScript) return;
  app.draftScript.roles.forEach((item, index) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector('[data-field="name"]').value = item.name;
    node.querySelector('[data-field="team"]').value = item.team;
    node.querySelector('[data-field="id"]').value = item.id;
    node.querySelector('[data-field="copies"]').value = item.copies || 1;
    node.querySelector('[data-field="ability"]').value = item.ability || "";
    node.querySelector('[data-field="firstNight"]').checked = Boolean(item.firstNight);
    node.querySelector('[data-field="otherNight"]').checked = Boolean(item.otherNight);
    const avatar = roleAvatarData(item);
    node.querySelector('[data-avatar-field="symbol"]').value = avatar.symbol;
    node.querySelector('[data-avatar-field="background"]').value = avatar.background;
    node.querySelector('[data-avatar-field="accent"]').value = avatar.accent;
    syncRoleEditorAvatarPreview(node, item);
    node.querySelectorAll("[data-field]").forEach((field) => {
      field.addEventListener("input", () => {
        const key = field.dataset.field;
        item[key] = field.type === "checkbox" ? field.checked : field.type === "number" ? Number(field.value) : field.value;
        syncRoleEditorAvatarPreview(node, item);
      });
    });
    node.querySelectorAll("[data-avatar-field]").forEach((field) => {
      field.addEventListener("input", () => {
        item.avatar = { ...roleAvatarData(item), [field.dataset.avatarField]: field.value };
        syncRoleEditorAvatarPreview(node, item);
      });
    });
    node.querySelector('[data-action="delete"]').addEventListener("click", () => {
      app.draftScript.roles.splice(index, 1);
      renderRoleEditor();
    });
    els.roleEditorList.append(node);
  });
}

function saveDraftScript() {
  if (!app.draftScript) return;
  app.draftScript.name = els.scriptNameInput.value.trim() || app.draftScript.name;
  app.draftScript.note = els.scriptNoteInput.value.trim();
  const roleIds = new Set(app.draftScript.roles.map((item) => item.id));
  app.draftScript.nightOrder = app.draftScript.nightOrder || { first: [], other: [] };
  app.draftScript.nightOrder.first = app.draftScript.roles.filter((item) => item.firstNight || app.draftScript.nightOrder.first.includes(item.id)).map((item) => item.id).filter((id) => roleIds.has(id));
  app.draftScript.nightOrder.other = app.draftScript.roles.filter((item) => item.otherNight || app.draftScript.nightOrder.other.includes(item.id)).map((item) => item.id).filter((id) => roleIds.has(id));
  hostAction("replaceScript", { script: app.draftScript });
}

function duplicateDraftScript() {
  if (!app.draftScript) return;
  app.draftScript.id = `${app.draftScript.id}-copy-${Date.now()}`;
  app.draftScript.name = `${app.draftScript.name} 副本`;
  els.scriptNameInput.value = app.draftScript.name;
  renderRoleEditor();
}

function addRoleToDraft() {
  if (!app.draftScript) return;
  app.draftScript.roles.push(
    makeRole(`custom_${Date.now()}`, "新角色", "townsfolk", "填写能力摘要。", 1, false, false, {
      avatar: { symbol: "新", background: "#355070", accent: "#f2cc8f" }
    })
  );
  renderRoleEditor();
}

function syncRoleEditorAvatarPreview(node, item) {
  const preview = node.querySelector("[data-avatar-preview]");
  if (preview) preview.innerHTML = roleAvatarHtml(item, "large");
}

async function importScript(event) {
  const file = event.target.files?.[0];
  if (!file || !isOwner()) return;
  const parsed = JSON.parse(await file.text());
  if (!parsed.id || !Array.isArray(parsed.roles)) {
    alert("板子 JSON 需要包含 id 和 roles。");
    return;
  }
  await hostAction("replaceScript", { script: parsed });
  event.target.value = "";
}

function exportState() {
  if (!hasRoom()) return;
  downloadJson(app.state, `blood-room-${app.roomId}-${Date.now()}.json`);
}

async function importState(event) {
  const file = event.target.files?.[0];
  if (!file || !isOwner()) return;
  const parsed = JSON.parse(await file.text());
  const importedGame = parsed.game || parsed.state?.game || parsed;
  await hostAction("importGame", { game: importedGame });
  event.target.value = "";
}

function resetRoom() {
  if (!isOwner()) {
    leaveRoom();
    return;
  }
  if (confirm("确认重置当前房间？所有角色、聊天、日志都会清空。")) {
    hostAction("resetRoom");
  }
}

function activeScript() {
  return game().scripts.find((script) => script.id === game().activeScriptId) || game().scripts[0] || { roles: [], nightOrder: { first: [], other: [] } };
}

function roleById(roleId) {
  return activeScript().roles.find((item) => item.id === roleId);
}

function selectedPlayer() {
  return game().players.find((player) => player.id === app.selectedPlayerId);
}

function myPlayer() {
  return game().players.find((player) => player.id === me().playerId);
}

function dayFlow() {
  return game().dayFlow || { status: "idle", speakerQueue: [], speakerIndex: 0, votes: [], startedAt: 0 };
}

function currentDaySpeaker() {
  const flow = dayFlow();
  return game().players.find((player) => player.id === flow.speakerQueue?.[flow.speakerIndex]);
}

function isMySpeechTurn() {
  const speaker = currentDaySpeaker();
  return game().phase === "day" && dayFlow().status === "speaking" && speaker?.id === me().playerId;
}

function game() {
  return app.state?.game || {
    scripts: window.BLOOD_DATA.DEFAULT_SCRIPTS,
    activeScriptId: window.BLOOD_DATA.DEFAULT_SCRIPTS[0].id,
    storytellerMode: "human",
    llm: {},
    players: [],
    selectedBag: [],
    setup: { selectedBagCount: 0 },
    phase: "setup",
    day: 0,
    night: 0,
    nominations: [],
    dayFlow: { status: "idle", speakerQueue: [], speakerIndex: 0, votes: [], startedAt: 0 },
    chats: [],
    rooms: [],
    log: []
  };
}

function me() {
  return app.state?.me || { isHost: false, isOwner: false, isStoryteller: false, playerId: "", name: "" };
}

function hasRoom() {
  return Boolean(app.roomId && app.clientId && app.token);
}

function isHost() {
  return isOwner();
}

function isOwner() {
  return Boolean(app.state?.me?.isOwner ?? app.state?.me?.isHost);
}

function isStoryteller() {
  return Boolean(app.state?.me?.isStoryteller);
}

function selectedBagCount() {
  return isStoryteller() ? game().selectedBag.length : game().setup?.selectedBagCount || 0;
}

function getSetupCounts() {
  const count = game().players.length;
  return activeScript().setupTable?.[count] || DEFAULT_SETUP[count] || null;
}

function countBag(bag) {
  return bag.reduce(
    (acc, roleId) => {
      const item = roleById(roleId);
      if (item) acc[item.team] = (acc[item.team] || 0) + 1;
      return acc;
    },
    { townsfolk: 0, outsider: 0, minion: 0, demon: 0 }
  );
}

function badgesForPlayer(player) {
  const badges = [{ text: player.alive ? "存活" : "死亡", color: player.alive ? "green" : "red" }];
  if (player.ai) badges.push({ text: "AI", color: "blue" });
  if (isStoryteller()) {
    if (player.poisoned) badges.push({ text: "中毒", color: "red" });
    if (player.drunk) badges.push({ text: "醉酒", color: "red" });
    if (!player.alive) badges.push({ text: player.ghostVote ? "死票可用" : "死票已用" });
  } else if (player.id === me().playerId && !player.alive) {
    badges.push({ text: player.ghostVote ? "死票可用" : "死票已用" });
  }
  return badges;
}

function evaluateWinCondition() {
  const alive = game().players.filter((player) => player.alive);
  if (!isStoryteller()) return alive.length ? `${alive.length} 名存活` : "等待玩家";
  const demonAlive = alive.some((player) => roleById(player.roleId)?.team === "demon");
  if (game().players.some((player) => player.roleId) && !demonAlive) return "恶魔已死：通常善良获胜";
  if (alive.length > 0 && alive.length <= 2 && demonAlive) return "仅剩两名存活：通常邪恶获胜";
  if (!game().players.length) return "等待玩家";
  return `${alive.length} 名存活，游戏继续`;
}

function phaseLabel() {
  const current = game();
  if (current.phase === "setup") return "准备中";
  if (current.phase === "firstNight") return "首夜";
  if (current.phase === "day") return `第 ${current.day} 天白天`;
  return `第 ${current.night} 夜`;
}

function formatCounts(counts) {
  return `镇民 ${counts.townsfolk} / 外来者 ${counts.outsider} / 爪牙 ${counts.minion} / 恶魔 ${counts.demon}`;
}

function nameOf(playerId) {
  return game().players.find((player) => player.id === playerId)?.name || "未知玩家";
}

function displayActor(id) {
  if (id === "storyteller") return "说书人";
  return nameOf(id);
}

function displayRecipient(value) {
  if (value === "public") return "公开广场";
  if (value === "storyteller") return "说书人";
  if (value?.startsWith("player:")) return nameOf(value.slice(7));
  if (value?.startsWith("room:")) return game().rooms.find((room) => room.id === value.slice(5))?.name || "私聊房";
  return value || "";
}

function roleAvatarHtml(item, extraClass = "") {
  const avatar = roleAvatarData(item);
  const teamClass = safeClassToken(item?.team || "unknown");
  const label = item?.name ? `${item.name}头像` : "隐藏角色头像";
  const classes = ["role-avatar", teamClass, extraClass].filter(Boolean).join(" ");
  return `<span class="${classes}" style="--avatar-bg:${avatar.background};--avatar-accent:${avatar.accent}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><span>${escapeHtml(avatar.symbol)}</span></span>`;
}

function roleAvatarData(item) {
  const team = item?.team || "unknown";
  const fallback = TEAM_AVATAR_FALLBACKS[team] || TEAM_AVATAR_FALLBACKS.unknown;
  const avatar = item?.avatar || {};
  return {
    symbol: safeAvatarSymbol(avatar.symbol || item?.name || "?"),
    background: safeCssColor(avatar.background, fallback.background),
    accent: safeCssColor(avatar.accent, fallback.accent)
  };
}

function safeAvatarSymbol(value) {
  const chars = Array.from(String(value || "?").trim());
  return chars.slice(0, 2).join("") || "?";
}

function safeCssColor(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function safeClassToken(value) {
  return String(value || "unknown").replace(/[^a-z0-9_-]/gi, "") || "unknown";
}

function getRoomFromUrl() {
  return normalizeRoomId(new URL(window.location.href).searchParams.get("room") || "");
}

function normalizeRoomId(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    alert("浏览器拒绝访问剪贴板，可以手动复制输入框内容。");
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
