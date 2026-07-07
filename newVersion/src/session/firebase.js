/**
 * Firebase initialization and helpers. Auth is email/password based so every
 * player has a stable uid before they can create or join a room.
 */
import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, set, update, remove, push, onValue, off,
  onChildAdded, serverTimestamp, get, child
} from "firebase/database";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "firebase/auth";
import { firebaseConfig } from "../firebase-config.js";

let app = null;
let db = null;
let auth = null;

export function isFirebaseConfigured() {
  return !!firebaseConfig;
}

function ensureInit() {
  if (!firebaseConfig) throw new Error("Firebase 未配置,请编辑 src/firebase-config.js");
  if (!app) {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    auth = getAuth(app);
  }
}

export function watchAuth(callback) {
  ensureInit();
  return onAuthStateChanged(auth, (user) => {
    if (user?.isAnonymous) {
      signOut(auth).catch(() => {});
      callback(null);
      return;
    }
    callback(user);
  });
}

export function getCurrentUser() {
  ensureInit();
  return auth.currentUser;
}

export async function registerWithEmail({ email, password, displayName }) {
  ensureInit();
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const name = String(displayName || "").trim();
  if (name) await updateProfile(cred.user, { displayName: name });
  return auth.currentUser;
}

export async function loginWithEmail({ email, password }) {
  ensureInit();
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logout() {
  ensureInit();
  await signOut(auth);
}

export async function ensureAuth() {
  ensureInit();
  if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error("请先使用邮箱登录再进入游戏");
  return auth.currentUser.uid;
}

export function roomRef(code, ...path) {
  ensureInit();
  return ref(db, ["rooms", code, ...path].join("/"));
}

export const fb = {
  set, update, remove, push, onValue, off, onChildAdded, serverTimestamp, get, child
};

export function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

