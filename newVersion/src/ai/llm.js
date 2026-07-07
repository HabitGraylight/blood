/**
 * MiniMax-M3 LLM client.
 *
 * The browser calls the same-origin Vite proxy at /api/minimax/v1/messages.
 * The proxy injects the API key from environment variables, so users no longer
 * type model endpoints or keys inside the app UI.
 */

const DEFAULT_MODEL = "MiniMax-M3";
const DEFAULT_ENDPOINT = "/api/minimax/v1/messages";

const env = import.meta.env || {};

export const DEFAULT_LLM_CONFIG = {
  provider: "minimax",
  protocol: "anthropic",
  endpoint: env.VITE_MINIMAX_ENDPOINT || DEFAULT_ENDPOINT,
  model: env.VITE_MINIMAX_MODEL || DEFAULT_MODEL,
  temperature: Number(env.VITE_LLM_TEMPERATURE || 0.9)
};

export function getLLMConfig() {
  return { ...DEFAULT_LLM_CONFIG };
}

export function isLLMConfigured() {
  if (env.VITE_DISABLE_LLM === "true") return false;
  if (typeof __LLM_CONFIGURED__ !== "undefined") return __LLM_CONFIGURED__;
  return true;
}

export async function chatComplete(messages, options = {}) {
  if (!isLLMConfigured()) throw new Error("LLM 环境变量未配置");

  const cfg = getLLMConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 45000);
  try {
    return await anthropicRequest(cfg, messages, options, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function anthropicRequest(cfg, messages, options, signal) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");

  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: options.maxTokens || 600,
      temperature: options.temperature != null ? options.temperature : cfg.temperature,
      ...(system ? { system } : {}),
      messages: rest.map((m) => ({ role: m.role, content: m.content }))
    }),
    signal
  });

  if (!res.ok) throw new Error(`LLM 请求失败: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  if (!text) throw new Error("LLM 返回为空");
  return text;
}

export function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    const candidates = text.match(/\{[^{}]*\}/g);
    if (candidates) {
      for (let i = candidates.length - 1; i >= 0; i--) {
        try {
          return JSON.parse(candidates[i]);
        } catch {
          // Continue trying earlier JSON-looking snippets.
        }
      }
    }
    return null;
  }
}
