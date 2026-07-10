/**
 * Vercel Serverless 转发代理 — 顶替 vite dev proxy 在生产环境的角色。
 *
 * 前端 llm.js 发 POST /api/minimax/v1/messages，
 * 本函数读 Vercel 环境变量注入 x-api-key + anthropic-version 后转发到 MiniMax。
 * 浏览器端永远看不到 API key，也不存在 CORS 问题。
 *
 * 注意:
 * 1. 这是普通 Vercel Functions(非 Next.js)，文件名不能用 [param] / [...path]
 *    这种方括号动态段语法 —— 那些只对 Next.js 有效。故本文件命名为
 *    api/minimax.js 并配合 vercel.json 的 rewrite 接管 /api/minimax/* 子路径。
 * 2. Vercel 已把 Content-Type: application/json 的请求体解析到 req.body，
 *    不要再手动 req.on('data'/'end') 读流(流已被消费，end 不会再触发，
 *    会导致 Promise 一直 pending 直到前端超时 —— 这也是之前线上失败的原因之一)。
 *
 * 需要的 Vercel 环境变量:
 *   MINIMAX_API_KEY        必填
 *   ANTHROPIC_BASE_URL     可选，默认 https://api.minimaxi.com/anthropic
 *   LLM_PROXY_TOKEN        可选，共享令牌；设置后请求必须携带 x-proxy-token 头
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-proxy-token",
  "Access-Control-Max-Age": "86400",
};

const MAX_BODY = 200 * 1024; // 200 KB 上限

export default async function handler(req, res) {
  // ---- CORS 预检 ----
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // ---- 仅允许 POST ----
  if (req.method !== "POST") {
    res.writeHead(405, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  // ---- 校验 API Key ----
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "代理未配置 MINIMAX_API_KEY" }));
    return;
  }

  // ---- 共享令牌(可选) ----
  const proxyToken = process.env.LLM_PROXY_TOKEN;
  if (proxyToken && req.headers["x-proxy-token"] !== proxyToken) {
    res.writeHead(401, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // ---- 请求体:Vercel 已自动解析 JSON 到 req.body ----
  let bodyText;
  if (typeof req.body === "string") {
    bodyText = req.body;
  } else if (req.body && typeof req.body === "object") {
    bodyText = JSON.stringify(req.body);
  } else {
    bodyText = "";
  }

  if (!bodyText) {
    res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Bad Request: empty body" }));
    return;
  }
  if (bodyText.length > MAX_BODY) {
    res.writeHead(413, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Payload Too Large" }));
    return;
  }

  // ---- 上游请求 ----
  const base = (process.env.MINIMAX_BASE_URL || process.env.ANTHROPIC_BASE_URL || "https://api.minimaxi.com/anthropic").replace(/\/$/, "");

  try {
    const upstream = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: bodyText,
    });

    res.writeHead(upstream.status, {
      ...CORS,
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
    });
    res.end(await upstream.text());
  } catch (err) {
    console.error("LLM 代理上游请求失败:", err.message);
    res.writeHead(502, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "上游请求失败", detail: err.message }));
  }
}
