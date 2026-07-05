const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createUserStore } = require("../src/server/user-store.js");

test("users persist outside the code path and passwords are not exposed", () => {
  const dataPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "blood-users-")), "users.json");
  const store = createUserStore({ dataPath });
  const registered = store.register({
    username: "habit_user",
    password: "strong-password",
    displayName: "Habit"
  });

  assert.equal(registered.user.username, "habit_user");
  assert.equal(registered.user.displayName, "Habit");
  assert.equal(Object.hasOwn(registered.user, "passwordHash"), false);
  assert.ok(registered.sessionToken);

  const reloaded = createUserStore({ dataPath });
  const login = reloaded.login({ username: "habit_user", password: "strong-password" });
  assert.equal(login.user.id, registered.user.id);
  assert.ok(reloaded.authenticate(login.user.id, login.sessionToken));

  const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  assert.equal(raw.users.length, 1);
  assert.notEqual(raw.users[0].passwordHash, "strong-password");
  assert.equal(raw.sessions.every((session) => session.tokenHash && !session.token), true);
});

test("usernames are unique and passwords have a minimum length", () => {
  const dataPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "blood-users-")), "users.json");
  const store = createUserStore({ dataPath });

  assert.throws(() => store.register({ username: "ab", password: "strong-password" }), /用户名/);
  assert.throws(() => store.register({ username: "valid_user", password: "short" }), /密码/);

  store.register({ username: "valid_user", password: "strong-password" });
  assert.throws(() => store.register({ username: "valid_user", password: "another-password" }), /用户名已存在/);
});
