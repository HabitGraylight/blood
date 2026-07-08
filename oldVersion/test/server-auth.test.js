const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createServer } = require("../src/server/server.js");
const { createUserStore } = require("../src/server/user-store.js");

test("HTTP API requires an account to create or join rooms", async () => {
  const dataPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "blood-http-users-")), "users.json");
  const userStore = createUserStore({ dataPath });
  const { server } = createServer({ userStore });

  const denied = await request(server, "POST", "/api/rooms", { roomName: "Denied" });
  assert.equal(denied.status, 401);

  const host = await request(server, "POST", "/api/auth/register", {
    username: "host_user",
    password: "strong-password",
    displayName: "房主"
  });
  const room = await request(server, "POST", "/api/rooms", {
    roomName: "持久用户房",
    auth: { userId: host.body.user.id, sessionToken: host.body.sessionToken }
  });
  assert.equal(room.status, 200);
  assert.equal(room.body.state.me.userId, host.body.user.id);
  assert.equal(room.body.state.game.players[0].name, "房主");

  const player = await request(server, "POST", "/api/auth/register", {
    username: "player_user",
    password: "strong-password",
    displayName: "玩家"
  });
  const joined = await request(server, "POST", `/api/rooms/${room.body.roomId}/join`, {
    auth: { userId: player.body.user.id, sessionToken: player.body.sessionToken }
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.state.me.userId, player.body.user.id);
  assert.equal(joined.body.state.room.playerCount, 2);
});

function request(server, method, url, body) {
  return new Promise((resolve) => {
    const handler = server.listeners("request")[0];
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = { host: "test.local" };
    req.destroy = () => {};

    const chunks = [];
    const res = {
      status: 200,
      headers: {},
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      write(chunk) {
        chunks.push(Buffer.from(chunk));
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: this.status, headers: this.headers, body: text ? JSON.parse(text) : {} });
      }
    };

    handler(req, res);
    queueMicrotask(() => {
      if (body) req.emit("data", Buffer.from(JSON.stringify(body)));
      req.emit("end");
    });
  });
}
