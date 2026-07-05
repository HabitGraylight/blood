const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { createRoomStore } = require("./room-store.js");
const { createLlmService } = require("./llm-service.js");

const DEFAULT_PORT = Number(process.env.PORT || 8000);
const CLIENT_ROOT = path.resolve(__dirname, "../client");
const SHARED_ROOT = path.resolve(__dirname, "../shared");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function createServer(options = {}) {
  const store = options.store || createRoomStore();
  const llmService = options.llmService || createLlmService(options.llm || {});
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(store, llmService, req, res, url);
        return;
      }
      serveStatic(url.pathname, res);
    } catch (error) {
      sendJson(res, error.code || 500, { error: error.message });
    }
  });
  return { server, store, llmService };
}

async function handleApi(store, llmService, req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readJson(req);
    sendJson(res, 200, store.createRoom(body.roomName, body.name));
    return;
  }

  if (parts[0] === "api" && parts[1] === "rooms" && parts[2]) {
    const roomId = parts[2];

    if (req.method === "POST" && parts[3] === "join") {
      const body = await readJson(req);
      sendJson(res, 200, store.joinRoom(roomId, body.name));
      return;
    }

    if (req.method === "GET" && parts[3] === "events") {
      openEventStream(store, roomId, url, res);
      return;
    }

    if (req.method === "GET" && parts.length === 3) {
      const state = store.getState(roomId, url.searchParams.get("clientId"), url.searchParams.get("token"));
      sendJson(res, 200, { state });
      return;
    }

    if (req.method === "POST" && parts[3] === "actions") {
      const body = await readJson(req);
      const result = store.applyAction(roomId, body.clientId, body.token, body.type, body.payload || {});
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && parts[3] === "llm") {
      const body = await readJson(req);
      const result = await llmService.complete(store, roomId, body.clientId, body.token, body);
      sendJson(res, 200, result);
      return;
    }
  }

  sendJson(res, 404, { error: "Not found" });
}

function openEventStream(store, roomId, url, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  let unsubscribe;
  try {
    unsubscribe = store.subscribe(
      roomId,
      url.searchParams.get("clientId"),
      url.searchParams.get("token"),
      (snapshot) => writeSse(res, snapshot)
    );
  } catch (error) {
    writeSse(res, { error: error.message });
    res.end();
    return;
  }

  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 25000);
  res.on("close", () => {
    clearInterval(heartbeat);
    if (unsubscribe) unsubscribe();
  });
}

function serveStatic(pathname, res) {
  if (pathname === "/shared/game-data.js") {
    sendFile(path.join(SHARED_ROOT, "game-data.js"), SHARED_ROOT, res);
    return;
  }
  const clean = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  sendFile(path.normalize(path.join(CLIENT_ROOT, clean)), CLIENT_ROOT, res);
}

function sendFile(filePath, root, res) {
  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(Object.assign(new Error("Payload too large"), { code: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(Object.assign(error, { code: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

if (require.main === module) {
  const { server } = createServer();
  server.listen(DEFAULT_PORT, "0.0.0.0", () => {
    console.log(`Blood room server listening on http://0.0.0.0:${DEFAULT_PORT}`);
  });
}

module.exports = { createServer };
