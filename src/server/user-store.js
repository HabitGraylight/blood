const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_DATA_DIR = process.env.BLOOD_DATA_DIR || path.join(PROJECT_ROOT, "data");
const DEFAULT_DATA_PATH = path.join(DEFAULT_DATA_DIR, "users.json");

function createUserStore(options = {}) {
  const dataPath = options.dataPath || DEFAULT_DATA_PATH;
  ensureDataFile(dataPath);
  let data = readData(dataPath);

  function register(payload = {}) {
    const username = normalizeUsername(payload.username);
    const password = String(payload.password || "");
    const displayName = cleanText(payload.displayName || username, 28);
    validateUsername(username);
    validatePassword(password);
    if (data.users.some((user) => user.username === username)) {
      throw httpError(409, "用户名已存在");
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const user = {
      id: crypto.randomUUID(),
      username,
      displayName,
      passwordHash: hashPassword(password, salt),
      salt,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    data.users.push(user);
    const session = createSession(user.id);
    persist();
    return { user: publicUser(user), sessionToken: session.token };
  }

  function login(payload = {}) {
    const username = normalizeUsername(payload.username);
    const password = String(payload.password || "");
    const user = data.users.find((item) => item.username === username);
    if (!user || hashPassword(password, user.salt) !== user.passwordHash) {
      throw httpError(401, "用户名或密码错误");
    }
    const session = createSession(user.id);
    user.updatedAt = Date.now();
    persist();
    return { user: publicUser(user), sessionToken: session.token };
  }

  function logout(userId, token) {
    const hash = hashToken(token);
    const before = data.sessions.length;
    data.sessions = data.sessions.filter((session) => session.userId !== userId || session.tokenHash !== hash);
    if (data.sessions.length !== before) persist();
    return { ok: true };
  }

  function authenticate(userId, token) {
    if (!userId || !token) return null;
    const hash = hashToken(token);
    const session = data.sessions.find((item) => item.userId === userId && item.tokenHash === hash);
    if (!session) return null;
    const user = data.users.find((item) => item.id === userId);
    if (!user) return null;
    session.lastSeenAt = Date.now();
    persist();
    return publicUser(user);
  }

  function reload() {
    data = readData(dataPath);
  }

  function createSession(userId) {
    const token = crypto.randomBytes(24).toString("hex");
    data.sessions.push({
      id: crypto.randomUUID(),
      userId,
      tokenHash: hashToken(token),
      createdAt: Date.now(),
      lastSeenAt: Date.now()
    });
    return { token };
  }

  function persist() {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  }

  return { register, login, logout, authenticate, reload, dataPath };
}

function ensureDataFile(dataPath) {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(dataPath, JSON.stringify({ version: 1, users: [], sessions: [] }, null, 2) + "\n", { mode: 0o600 });
  }
}

function readData(dataPath) {
  const parsed = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  return {
    version: 1,
    users: Array.isArray(parsed.users) ? parsed.users : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt
  };
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validateUsername(username) {
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    throw httpError(400, "用户名需要 3-24 位，只能包含小写字母、数字和下划线");
  }
}

function validatePassword(password) {
  if (password.length < 8 || password.length > 128) {
    throw httpError(400, "密码需要 8-128 位");
  }
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function httpError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { createUserStore };
