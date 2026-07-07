/**
 * 生产环境 LLM 转发代理 (Cloudflare Worker)。
 *
 * 作用:静态托管(vite build)后浏览器无法再依赖 Vite 开发代理注入 API key,
 * 部署本 Worker 后,客户端通过 VITE_MINIMAX_ENDPOINT 指向它,key 只存在于 Worker 环境。
 *
 * 部署步骤:
 *   1. npx wrangler deploy --config workers/wrangler.toml
 *   2. npx wrangler secret put MINIMAX_API_KEY --config workers/wrangler.toml
 *   3. (可选,推荐) npx wrangler secret put PROXY_TOKEN --config workers/wrangler.toml
 *   4. 前端构建时设置:
 *        VITE_MINIMAX_ENDPOINT=https://<worker域名>/v1/messages
 *        VITE_LLM_PROXY_TOKEN=<与 PROXY_TOKEN 相同>   (如果启用了令牌)
 *
 * 环境变量:
 *   MINIMAX_API_KEY   必填,MiniMax API key(用 wrangler secret 设置,勿写入代码)
 *   MINIMAX_BASE_URL  可选,默认 https://api.minimaxi.com/anthropic
 *   PROXY_TOKEN       可选,共享令牌;设置后请求必须携带 x-proxy-token 头,防止代理被盗用
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-proxy-token",
  "Access-Control-Max-Age": "86400"
};

const MAX_BODY_BYTES = 200 * 1024; // 请求体上限,防滥用

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405);
    }
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/v1/messages")) {
      return json({ error: "Not Found" }, 404);
    }
    if (!env.MINIMAX_API_KEY) {
      return json({ error: "代理未配置 MINIMAX_API_KEY" }, 500);
    }
    // 共享令牌校验
    if (env.PROXY_TOKEN && request.headers.get("x-proxy-token") !== env.PROXY_TOKEN) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return json({ error: "Payload Too Large" }, 413);
    }

    const base = (env.MINIMAX_BASE_URL || "https://api.minimaxi.com/anthropic").replace(/\/$/, "");
    const upstream = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.MINIMAX_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}
