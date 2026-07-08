/**
 * 生产环境 LLM 转发代理 (Firebase Functions v2)。
 *
 * 与游戏同域名:firebase.json 把 /api/minimax/** 重写到本函数,
 * 前端保持默认路径 /api/minimax/v1/messages 即可,无需任何构建期变量,
 * 也不存在跨域和 workers.dev 被墙的问题。
 *
 * 部署:
 *   1. cd functions && npm install
 *   2. firebase functions:secrets:set MINIMAX_API_KEY   (粘贴 key)
 *   3. firebase deploy --only functions,hosting
 * 需要 Blaze(按量付费)计划才能部署 Functions。
 */
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const MINIMAX_API_KEY = defineSecret("MINIMAX_API_KEY");
const BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/anthropic";
const MAX_BODY_BYTES = 200 * 1024;

/** 只允许自家站点与本地开发调用,防止代理被第三方白嫖 */
function originAllowed(origin) {
  if (!origin) return true; // 非浏览器调用(如 curl 测试)
  try {
    const host = new URL(origin).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".web.app") ||
      host.endsWith(".firebaseapp.com")
    );
  } catch {
    return false;
  }
}

exports.llmProxy = onRequest(
  {
    region: "asia-southeast1",
    secrets: [MINIMAX_API_KEY],
    maxInstances: 2,
    timeoutSeconds: 90,
    memory: "256MiB"
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }
    if (!originAllowed(req.get("origin"))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const body = JSON.stringify(req.body || {});
    if (body.length > MAX_BODY_BYTES) {
      res.status(413).json({ error: "Payload Too Large" });
      return;
    }

    try {
      const upstream = await fetch(`${BASE_URL.replace(/\/$/, "")}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": MINIMAX_API_KEY.value(),
          "anthropic-version": "2023-06-01"
        },
        body
      });
      const text = await upstream.text();
      res.status(upstream.status).set("Content-Type", "application/json").send(text);
    } catch (err) {
      res.status(502).json({ error: `上游请求失败: ${err.message}` });
    }
  }
);
