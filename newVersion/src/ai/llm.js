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
  temperature: Number(env.VITE_LLM_TEMPERATURE || 0.7)
};

/**
 * max_tokens 全局缩放系数(默认 1)。
 * MiniMax-M3 是原生推理模型:若上游开启 thinking,思考内容会计入 max_tokens
 * (本客户端只提取 text 块,thinking 被丢弃但仍占额度)。
 * 观察 console 的 [LLM Probe] 日志:若出现 thinking 块且 output_tokens 远大于可见文本,
 * 设 VITE_LLM_MAXTOKENS_SCALE=2 避免可见回复被思考挤掉而截断。
 */
const MAXTOKENS_SCALE = Math.max(0.5, Number(env.VITE_LLM_MAXTOKENS_SCALE || 1));

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

/** 新对局开始时重置预算与缓存统计 */
export function resetLLMBudget() {
  budgetUsed = 0;
  budgetWarned = false;
  resetCacheStats();
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

/* ---------------- 缓存用量监控 ---------------- */

let _cacheStats = { creation: 0, read: 0, calls: 0 };

/** 最近一次请求的完整 usage(input/output/cache 四项)与非 text 块类型,供 debugLogger 记录 */
let _lastUsage = null;

export function getLastUsage() {
  return _lastUsage ? { ..._lastUsage } : null;
}

/** 获取累计缓存用量统计(供测试/监控使用) */
export function getCacheStats() {
  return { ..._cacheStats };
}

/** 重置缓存用量统计(新对局开始) */
export function resetCacheStats() {
  _cacheStats = { creation: 0, read: 0, calls: 0 };
}

/* ---------------- 请求 ---------------- */

/**
 * 调用 LLM 完成对话。
 *
 * @param {Array} messages - 消息数组 [{role, content}]
 *   // 兼容旧格式: 包含 system role 的消息会被提取为字符串 system
 * @param {object} options
 *   // 新格式(推荐): systemBlocks 直接作为 Anthropic system 数组,支持 cache_control
 * @param {Array} options.systemBlocks - [{type:"text", text, cache_control?:{type:"ephemeral"}}]
 * @returns {string} 返回模型输出文本
 */
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
  // 新格式: options.systemBlocks 直接作为 Anthropic system 数组(支持 cache_control 多断点)
  // 旧格式兼容: messages 中包含 system role 的消息提取为字符串
  let system;
  if (options.systemBlocks && options.systemBlocks.length) {
    system = options.systemBlocks;
  } else {
    const sysText = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    if (sysText) system = sysText;
  }

  const rest = options.systemBlocks
    ? messages // 使用 systemBlocks 时,messages 不含 system role
    : messages.filter((m) => m.role !== "system");

  const headers = { "Content-Type": "application/json" };
  // 生产代理的共享令牌(防止被第三方白嫖)
  if (env.VITE_LLM_PROXY_TOKEN) headers["x-proxy-token"] = env.VITE_LLM_PROXY_TOKEN;

  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: Math.round((options.maxTokens || 600) * MAXTOKENS_SCALE),
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

  // 解析缓存用量(MiniMax Anthropic 兼容接口)
  if (data.usage) {
    const created = data.usage.cache_creation_input_tokens || 0;
    const read = data.usage.cache_read_input_tokens || 0;
    _cacheStats.calls++;
    if (created > 0) _cacheStats.creation += created;
    if (read > 0) _cacheStats.read += read;
    if (created > 0 || read > 0) {
      console.debug(
        `[LLM Cache] 创建=${created} tokens, 读取=${read} tokens ` +
        `(累计: 创建=${_cacheStats.creation}, 读取=${_cacheStats.read}, 调用=${_cacheStats.calls})`
      );
    }
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  // thinking 探测:记录非 text 块类型与 usage,判断上游是否开启了原生推理
  // (thinking 内容被本客户端丢弃,但 token 计入 max_tokens——见 MAXTOKENS_SCALE 说明)
  const nonTextTypes = (data.content || [])
    .filter((block) => block.type !== "text")
    .map((block) => block.type);
  _lastUsage = {
    input_tokens: data.usage?.input_tokens || 0,
    output_tokens: data.usage?.output_tokens || 0,
    cache_creation_input_tokens: data.usage?.cache_creation_input_tokens || 0,
    cache_read_input_tokens: data.usage?.cache_read_input_tokens || 0,
    non_text_blocks: nonTextTypes,
    visible_chars: text.length
  };
  if (nonTextTypes.length) {
    console.debug(
      `[LLM Probe] 检测到非text块: ${nonTextTypes.join(",")}; output_tokens=${_lastUsage.output_tokens}, 可见文本=${text.length}字 ` +
      `(若 thinking 持续占大头,请设 VITE_LLM_MAXTOKENS_SCALE=2)`
    );
  }

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
