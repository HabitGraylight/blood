/**
 * LLM 客户端:同时支持 OpenAI 协议与 Anthropic 协议的兼容接口。
 * - OpenAI 协议: DeepSeek、Kimi、通义、OpenAI 等 (POST {endpoint} /chat/completions 格式)
 * - Anthropic 协议: MiniMax、Claude 等 (POST {endpoint} /v1/messages 格式)
 * 配置保存在浏览器 localStorage,API Key 不会进入代码仓库。
 * 未配置时 AI 玩家自动回退到启发式逻辑,游戏离线可玩。
 */

const STORAGE_KEY = "botc.llm.config";

/** 常用服务预设 */
export const LLM_PRESETS = {
  deepseek: {
    label: "DeepSeek",
    protocol: "openai",
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat"
  },
  minimax: {
    label: "MiniMax (Anthropic 协议)",
    protocol: "anthropic",
    endpoint: "https://api.minimaxi.com/anthropic/v1/messages",
    model: "MiniMax-M3"
  },
  custom: {
    label: "自定义",
    protocol: "openai",
    endpoint: "",
    model: ""
  }
};

export const DEFAULT_LLM_CONFIG = {
  preset: "deepseek",
  protocol: "openai",
  endpoint: LLM_PRESETS.deepseek.endpoint,
  apiKey: "",
  model: LLM_PRESETS.deepseek.model,
  temperature: 0.9
};

export function getLLMConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_LLM_CONFIG, ...JSON.parse(raw) };
  } catch {
    /* localStorage 不可用(测试环境)时忽略 */
  }
  return { ...DEFAULT_LLM_CONFIG };
}

export function saveLLMConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function isLLMConfigured() {
  const cfg = getLLMConfig();
  return !!(cfg.apiKey && cfg.endpoint && cfg.model);
}

/**
 * 发起一次对话补全。messages: [{role: "system"|"user"|"assistant", content}]
 * 自动按协议转换请求与响应格式。失败时抛出异常(调用方回退启发式)。
 */
export async function chatComplete(messages, options = {}) {
  const cfg = getLLMConfig();
  if (!cfg.apiKey) throw new Error("LLM 未配置 API Key");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 45000);
  try {
    if (cfg.protocol === "anthropic") {
      return await anthropicRequest(cfg, messages, options, controller.signal);
    }
    return await openaiRequest(cfg, messages, options, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function openaiRequest(cfg, messages, options, signal) {
  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: options.temperature != null ? options.temperature : cfg.temperature,
      max_tokens: options.maxTokens || 400
    }),
    signal
  });
  if (!res.ok) throw new Error(`LLM 请求失败: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("LLM 返回为空");
  return text;
}

async function anthropicRequest(cfg, messages, options, signal) {
  // Anthropic 协议:system 单独传,其余消息只允许 user/assistant 交替
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");

  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      // 允许浏览器直连(Anthropic 官方及兼容端点要求显式声明)
      "anthropic-dangerous-direct-browser-access": "true"
    },
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
  // 响应 content 是块数组,可能包含 thinking 块(如 MiniMax-M3),只取 text 块
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  if (!text) throw new Error("LLM 返回为空");
  return text;
}

/** 从模型输出中提取 JSON 对象(容忍代码块/前后废话/思考过程) */
export function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    // 尝试收缩到最后一个完整对象(思考文本里可能混入花括号)
    const candidates = text.match(/\{[^{}]*\}/g);
    if (candidates) {
      for (let i = candidates.length - 1; i >= 0; i--) {
        try {
          return JSON.parse(candidates[i]);
        } catch { /* 继续尝试 */ }
      }
    }
    return null;
  }
}
