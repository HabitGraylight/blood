/**
 * Firebase initialization and helpers. Auth is email/password based so every
 * player has a stable uid before they can create or join a room.
 */
import { initializeApp } from "firebase/app";
import {
  getDatabase, ref as databaseRef, set, update, remove, push, onValue, off,
  onChildAdded, serverTimestamp, get, child
} from "firebase/database";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "firebase/auth";
import { firebaseConfig } from "../firebase-config.js";
import { AVATAR_MAX_BYTES } from "./gameHistory.js";

let app = null;
let db = null;
let auth = null;
let storage = null;

export function isFirebaseConfigured() {
  return !!firebaseConfig;
}

function ensureInit() {
  if (!firebaseConfig) throw new Error("Firebase 未配置,请编辑 src/firebase-config.js");
  if (!app) {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    auth = getAuth(app);
    storage = getStorage(app);
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
  return databaseRef(db, ["rooms", code, ...path].join("/"));
}


export function userRef(uid, ...path) {
  ensureInit();
  return databaseRef(db, ["users", uid, ...path].join("/"));
}

export function userGameResultsRef(uid, ...path) {
  ensureInit();
  return databaseRef(db, ["userGameResults", uid, ...path].join("/"));
}

export function replayRef(gameId, ...path) {
  ensureInit();
  return databaseRef(db, ["replays", gameId, ...path].join("/"));
}

function avatarExtension(file) {
  const byType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };
  return byType[file.type] || "img";
}

export async function uploadUserAvatar(file) {
  ensureInit();
  const user = auth.currentUser;
  if (!user || user.isAnonymous) throw new Error("请先登录后再上传头像");
  if (!file || !file.type || !file.type.startsWith("image/")) throw new Error("请选择图片文件");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("头像文件不能超过 2MB");

  const avatarPath = "avatars/" + user.uid + "/avatar-" + Date.now() + "." + avatarExtension(file);
  const target = storageRef(storage, avatarPath);
  await uploadBytes(target, file, { contentType: file.type });
  const photoURL = await getDownloadURL(target);
  await updateProfile(user, { photoURL });
  await update(userRef(user.uid), {
    uid: user.uid,
    displayName: user.displayName || "",
    email: user.email || "",
    photoURL,
    avatarPath,
    updatedAt: Date.now()
  });
  return { photoURL, avatarPath };
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




