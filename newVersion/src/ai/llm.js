/**
 * MiniMax-M3 LLM client.
 *
 * 开发环境:浏览器调用同源 Vite 代理 /api/minimax/v1/messages,由代理注入 API key。
 * 生产环境:通过 VITE_MINIMAX_ENDPOINT 指向已部署的转发代理(见 workers/llm-proxy.js)。
 *
 * 内置成本控制:
 * - 全局并发信号量(默认同时 3 个请求)
 * - 每局调用预算(VITE_LLM_BUDGET: low/standard/high),超限后调用方自动回退启发式
 * - 429/5xx 指数退避重试
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

/* ---------------- 每局调用预算 ---------------- */

const BUDGET_TIERS = { low: 150, standard: 500, high: 1500 };

export function llmBudgetTier() {
  const t = String(env.VITE_LLM_BUDGET || "standard").toLowerCase();
  return t in BUDGET_TIERS ? t : "standard";
}

let budgetUsed = 0;
let budgetWarned = false;

/** 新对局开始时重置预算 */
export function resetLLMBudget() {
  budgetUsed = 0;
  budgetWarned = false;
}

export function getLLMUsage() {
  return { used: budgetUsed, limit: BUDGET_TIERS[llmBudgetTier()], tier: llmBudgetTier() };
}

function consumeBudget() {
  if (budgetUsed >= BUDGET_TIERS[llmBudgetTier()]) {
    if (!budgetWarned) {
      budgetWarned = true;
      console.warn(`本局 LLM 调用已达预算上限(${BUDGET_TIERS[llmBudgetTier()]}次,档位 ${llmBudgetTier()}),后续决策自动降级为启发式。`);
    }
    return false;
  }
  budgetUsed++;
  return true;
}

/* ---------------- 并发信号量 ---------------- */

const MAX_CONCURRENT = Math.max(1, Number(env.VITE_LLM_MAX_CONCURRENT || 3));
let inFlight = 0;
const waiters = [];

async function acquire() {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return;
  }
  await new Promise((resolve) => waiters.push(resolve));
  inFlight++;
}

function release() {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 请求 ---------------- */

export async function chatComplete(messages, options = {}) {
  if (!isLLMConfigured()) throw new Error("LLM 环境变量未配置");
  if (!consumeBudget()) throw new Error("本局 LLM 调用额度已用完");

  const cfg = getLLMConfig();
  await acquire();
  try {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 45000);
      try {
        return await anthropicRequest(cfg, messages, options, controller.signal);
      } catch (err) {
        lastErr = err;
        const retryable = [429, 500, 502, 503, 529].includes(err.status);
        if (!retryable || attempt === 2) throw err;
        await sleep(800 * 2 ** attempt + Math.random() * 400);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastErr;
  } finally {
    release();
  }
}

async function anthropicRequest(cfg, messages, options, signal) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");

  const headers = { "Content-Type": "application/json" };
  // 生产代理的共享令牌(防止被第三方白嫖)
  if (env.VITE_LLM_PROXY_TOKEN) headers["x-proxy-token"] = env.VITE_LLM_PROXY_TOKEN;

  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: options.maxTokens || 600,
      temperature: options.temperature != null ? options.temperature : cfg.temperature,
      ...(system ? { system } : {}),
      messages: rest.map((m) => ({ role: m.role, content: m.content }))
    }),
    signal
  });

  if (!res.ok) {
    const err = new Error(`LLM 请求失败: ${res.status} ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
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
