export function getRoleState(player, roleId = player?.role) {
  if (!player) return {};
  player.roleState = player.roleState && typeof player.roleState === "object" ? player.roleState : {};
  const key = roleId || "global";
  player.roleState[key] = player.roleState[key] && typeof player.roleState[key] === "object"
    ? player.roleState[key]
    : {};
  return player.roleState[key];
}

export function setRoleState(player, roleId, patch) {
  const current = getRoleState(player, roleId);
  Object.assign(current, patch || {});
  return current;
}

export function getStatus(player, kind) {
  const list = Array.isArray(player?.statuses) ? player.statuses : [];
  return list.find((s) => s && s.kind === kind) || null;
}

export function hasStatus(player, kind) {
  return !!getStatus(player, kind);
}

export function setUniqueStatus(player, status) {
  if (!player || !status?.kind) return null;
  player.statuses = Array.isArray(player.statuses) ? player.statuses : [];
  player.statuses = player.statuses.filter((s) => s && s.kind !== status.kind);
  const next = { ...status };
  player.statuses.push(next);
  return next;
}

export function clearStatuses(player, predicate) {
  if (!player) return;
  player.statuses = Array.isArray(player.statuses) ? player.statuses : [];
  if (typeof predicate !== "function") {
    player.statuses = [];
    return;
  }
  player.statuses = player.statuses.filter((status) => !predicate(status));
}

export function normalizePlayer(player) {
  if (!player) return player;
  player.roleState = player.roleState && typeof player.roleState === "object" ? player.roleState : {};
  player.statuses = Array.isArray(player.statuses) ? player.statuses : [];

  if (player.believedRole != null) {
    setRoleState(player, "drunk", { believedRole: player.believedRole });
  }
  if (player.master != null) {
    setRoleState(player, "butler", { masterSeat: player.master });
  }
  if (player.usedAbility != null) {
    setRoleState(player, player.role, { used: !!player.usedAbility });
  }
  if (player.slayerUsed != null) {
    setRoleState(player, "slayer", { used: !!player.slayerUsed });
  }
  if (player.poisonedBy != null) {
    setUniqueStatus(player, { kind: "poisoned", sourceSeat: player.poisonedBy, sourceRole: "poisoner" });
  }
  if (player.protectedBy != null) {
    setUniqueStatus(player, { kind: "protectedFromDemon", sourceSeat: player.protectedBy, sourceRole: "monk" });
  }
  if (player.redHerring === true) {
    setUniqueStatus(player, { kind: "redHerring", sourceRole: "fortuneteller" });
  }

  syncLegacyFields(player);
  return player;
}

export function normalizeGameState(state) {
  if (!state || !Array.isArray(state.players)) return state;
  for (const player of state.players) normalizePlayer(player);
  return state;
}

export function syncLegacyFields(player) {
  if (!player) return player;
  const drunk = getRoleState(player, "drunk");
  const butler = getRoleState(player, "butler");
  const own = getRoleState(player, player.role);
  const slayer = getRoleState(player, "slayer");
  const poison = getStatus(player, "poisoned");
  const protect = getStatus(player, "protectedFromDemon");

  player.believedRole = drunk.believedRole || null;
  player.master = butler.masterSeat ?? null;
  player.usedAbility = !!own.used;
  player.slayerUsed = !!slayer.used;
  player.poisonedBy = poison ? poison.sourceSeat ?? null : null;
  player.protectedBy = protect ? protect.sourceSeat ?? null : null;
  player.redHerring = hasStatus(player, "redHerring");
  return player;
}

export function setBelievedRole(player, roleId) {
  setRoleState(player, "drunk", { believedRole: roleId || null });
  return syncLegacyFields(player);
}

export function getBelievedRole(player) {
  return getRoleState(player, "drunk").believedRole || null;
}

export function setMasterSeat(player, seat) {
  setRoleState(player, "butler", { masterSeat: seat ?? null });
  return syncLegacyFields(player);
}

export function getMasterSeat(player) {
  return getRoleState(player, "butler").masterSeat ?? null;
}

export function setAbilityUsed(player, roleId = player.role, used = true) {
  setRoleState(player, roleId, { used: !!used });
  return syncLegacyFields(player);
}

export function isAbilityUsed(player, roleId = player.role) {
  return !!getRoleState(player, roleId).used;
}

export function setPoisonedBy(player, sourceSeat, sourceRole = "poisoner") {
  if (sourceSeat == null) clearStatuses(player, (s) => s.kind === "poisoned");
  else setUniqueStatus(player, { kind: "poisoned", sourceSeat, sourceRole });
  return syncLegacyFields(player);
}

export function setProtectedBy(player, sourceSeat, sourceRole = "monk") {
  if (sourceSeat == null) clearStatuses(player, (s) => s.kind === "protectedFromDemon");
  else setUniqueStatus(player, { kind: "protectedFromDemon", sourceSeat, sourceRole });
  return syncLegacyFields(player);
}

export function setRedHerring(player, enabled = true) {
  if (enabled) setUniqueStatus(player, { kind: "redHerring", sourceRole: "fortuneteller" });
  else clearStatuses(player, (s) => s.kind === "redHerring");
  return syncLegacyFields(player);
}
