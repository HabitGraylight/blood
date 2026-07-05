const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, "config/llm.config.json");
const DEFAULT_LOCAL_CONFIG_PATH = path.join(PROJECT_ROOT, "config/llm.local.json");
const DEFAULT_PROMPTS_ROOT = path.join(PROJECT_ROOT, "prompts");

function createLlmService(options = {}) {
  const usingDefaultConfig = !options.configPath;
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  const localConfigPath =
    options.localConfigPath === undefined ? (usingDefaultConfig ? DEFAULT_LOCAL_CONFIG_PATH : "") : options.localConfigPath;
  const promptsRoot = options.promptsRoot || DEFAULT_PROMPTS_ROOT;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  async function complete(store, roomId, clientId, token, payload = {}) {
    const kind = payload.kind || "storyteller-advice";
    if (kind === "ai-public-chat") {
      return completeAiPlayer(store, roomId, clientId, token, payload);
    }
    return completeStoryteller(store, roomId, clientId, token, payload);
  }

  async function completeStoryteller(store, roomId, clientId, token, payload) {
    const config = loadConfig(configPath, localConfigPath);
    const context = store.getStorytellerLlmContext(roomId, clientId, token, payload.instruction || "");
    const providerId = payload.providerId || context.game.llm?.providerId || config.storyteller?.providerId || config.defaults?.storytellerProvider || "default";
    const provider = selectProvider(config, providerId);
    const model = payload.model || context.game.llm?.model || config.storyteller?.model || provider.defaultModel || "";
    const messages = [
      { role: "system", content: loadPrompt(promptsRoot, "storyteller/system.md") },
      {
        role: "user",
        content: renderTemplate(loadPrompt(promptsRoot, "storyteller/advice.md"), {
          instruction: payload.instruction || "",
          contextJson: JSON.stringify(context, null, 2)
        })
      }
    ];
    const result = await completeWithProvider({
      fetchImpl,
      provider,
      providerId,
      model,
      messages,
      temperature: 0.7,
      allowPromptExport: context.requester.isStoryteller,
      promptUnavailableMessage: "LLM provider 未完整配置。LLM 说书人模式下不会向玩家房主导出包含隐藏魔典的 prompt。"
    });
    if (result.ok && !context.requester.isStoryteller) {
      const text = redactStorytellerOutputForPlayer(result.text || "", context);
      return { ...result, text, redacted: text !== result.text };
    }
    return result;
  }

  async function completeAiPlayer(store, roomId, clientId, token, payload) {
    const config = loadConfig(configPath, localConfigPath);
    const context = store.getAiPlayerLlmContext(roomId, clientId, token, payload.playerId, payload.instruction || "");
    const roleProvider = config.roleProviders?.[context.aiPlayer.roleId];
    const providerId =
      payload.providerId ||
      context.aiPlayer.providerId ||
      roleProvider ||
      config.defaults?.aiPlayerProvider ||
      "default";
    const provider = selectProvider(config, providerId);
    const model = payload.model || context.aiPlayer.model || provider.defaultModel || "";
    const rolePrompt = loadRolePrompt(promptsRoot, context.aiPlayer.roleId);
    const messages = [
      { role: "system", content: loadPrompt(promptsRoot, "ai-player/system.md") },
      { role: "system", content: rolePrompt },
      {
        role: "user",
        content: renderTemplate(loadPrompt(promptsRoot, "ai-player/public-chat.md"), {
          instruction: payload.instruction || "请根据当前公开局势发言。",
          contextJson: JSON.stringify(context, null, 2)
        })
      }
    ];
    return completeWithProvider({ fetchImpl, provider, providerId, model, messages, temperature: 0.85 });
  }

  return { complete };
}

async function completeWithProvider({
  fetchImpl,
  provider,
  providerId,
  model,
  messages,
  temperature,
  allowPromptExport = true,
  promptUnavailableMessage = "Provider 未完整配置。"
}) {
  const apiKey = provider.apiKey || (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : "");
  if (!provider.endpoint || !model || (provider.apiKeyEnv && !apiKey)) {
    if (!allowPromptExport) {
      return {
        ok: false,
        promptOnly: true,
        providerId,
        model,
        prompt: promptUnavailableMessage,
        messages: []
      };
    }
    return {
      ok: false,
      promptOnly: true,
      providerId,
      model,
      prompt: messages.map((message) => `[${message.role}]\n${message.content}`).join("\n\n"),
      messages
    };
  }
  if (!fetchImpl) {
    throw httpError(500, "当前 Node 运行时没有可用 fetch。");
  }

  const response = await fetchImpl(provider.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(provider.headers || {})
    },
    body: JSON.stringify({
      model,
      messages,
      temperature
    })
  });
  if (!response.ok) {
    throw httpError(502, `LLM provider ${providerId} 返回 HTTP ${response.status}`);
  }
  const data = await response.json();
  return {
    ok: true,
    providerId,
    model,
    text: data.choices?.[0]?.message?.content || ""
  };
}

function redactStorytellerOutputForPlayer(text, context) {
  const ownPlayer = context.game.players.find((player) => player.clientId === context.requester.clientId);
  const script =
    context.game.scripts.find((item) => item.id === context.game.activeScriptId) || context.game.scripts[0] || { roles: [] };
  const roleNamesById = new Map(script.roles.map((role) => [role.id, role.name]).filter((entry) => entry[0] && entry[1]));
  const allowedRoleIds = new Set([ownPlayer?.shownRoleId || ""].filter(Boolean));
  const forbiddenRoleNames = new Set();

  for (const player of context.game.players) {
    const roleIds = [player.roleId, player.shownRoleId].filter(Boolean);
    for (const roleId of roleIds) {
      if (player.id === ownPlayer?.id && allowedRoleIds.has(roleId)) continue;
      const roleName = roleNamesById.get(roleId);
      if (roleName) forbiddenRoleNames.add(roleName);
    }
  }

  let redacted = text;
  for (const roleName of [...forbiddenRoleNames].sort((a, b) => b.length - a.length)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(roleName), "g"), "某隐藏角色");
  }
  return redacted;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadConfig(configPath, localConfigPath) {
  try {
    const config = readJson(configPath);
    if (localConfigPath && fs.existsSync(localConfigPath)) {
      return deepMerge(config, readJson(localConfigPath));
    }
    return config;
  } catch (error) {
    throw httpError(500, `无法读取 LLM 配置：${error.message}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return merged;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function selectProvider(config, providerId) {
  const provider = config.providers?.[providerId];
  if (!provider) throw httpError(400, `LLM provider 不存在：${providerId}`);
  if (provider.type && provider.type !== "openai-compatible") {
    throw httpError(400, `暂不支持 provider 类型：${provider.type}`);
  }
  return provider;
}

function loadPrompt(promptsRoot, relativePath) {
  return fs.readFileSync(path.join(promptsRoot, relativePath), "utf8").trim();
}

function loadRolePrompt(promptsRoot, roleId) {
  const safeRoleId = String(roleId || "").replace(/[^a-z0-9_-]/gi, "");
  const rolePath = safeRoleId ? path.join(promptsRoot, `roles/${safeRoleId}.md`) : "";
  if (rolePath && fs.existsSync(rolePath)) return fs.readFileSync(rolePath, "utf8").trim();
  return loadPrompt(promptsRoot, "roles/default.md");
}

function renderTemplate(template, values) {
  return template.replaceAll("{{instruction}}", values.instruction || "").replaceAll("{{contextJson}}", values.contextJson || "");
}

function httpError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { createLlmService };
