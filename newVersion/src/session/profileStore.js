import { fb, userRef, userGameResultsRef, replayRef } from "./firebase.js";

export async function ensureUserProfile(user) {
  if (!user || user.isAnonymous) return;
  await fb.update(userRef(user.uid), {
    uid: user.uid,
    displayName: user.displayName || "",
    email: user.email || "",
    photoURL: user.photoURL || "",
    updatedAt: Date.now()
  });
}

export function watchUserProfile(uid, callback) {
  const target = userRef(uid);
  const handler = (snap) => callback(snap.val() || null);
  fb.onValue(target, handler);
  return () => fb.off(target, "value", handler);
}

export function watchUserGameResults(uid, callback) {
  const target = userGameResultsRef(uid);
  const handler = (snap) => callback(snap.val() || {});
  fb.onValue(target, handler);
  return () => fb.off(target, "value", handler);
}

export async function saveUserGameResult(uid, result) {
  if (!uid || !result || !result.gameId) return;
  await fb.set(userGameResultsRef(uid, result.gameId), result);
}

export async function saveGameReplay(replay) {
  if (!replay || !replay.gameId) return;
  await fb.set(replayRef(replay.gameId), replay);
}

export async function getGameReplay(gameId) {
  if (!gameId) return null;
  const snap = await fb.get(replayRef(gameId));
  return snap.exists() ? snap.val() : null;
}
