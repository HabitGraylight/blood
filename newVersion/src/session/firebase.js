/**
 * Firebase 初始化与工具封装。只在这里接触 firebase SDK,方便替换后端。
 */
import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, set, update, remove, push, onValue, off,
  onChildAdded, serverTimestamp, get, child
} from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
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

/** 匿名登录,返回 uid */
export async function ensureAuth() {
  ensureInit();
  if (auth.currentUser) return auth.currentUser.uid;
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}

export function roomRef(code, ...path) {
  ensureInit();
  return ref(db, ["rooms", code, ...path].join("/"));
}

export const fb = {
  set, update, remove, push, onValue, off, onChildAdded, serverTimestamp, get, child
};

/** 生成 4 位房间码 */
export function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
