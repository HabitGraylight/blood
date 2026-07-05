const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRoomStore } = require("../src/server/room-store.js");
const { createLlmService } = require("../src/server/llm-service.js");

test("LLM service returns promptOnly when provider config is incomplete", async () => {
  const configPath = writeTempConfig({
    providers: {
      deepseek: {
        type: "openai-compatible",
        endpoint: "https://api.deepseek.com/chat/completions",
        apiKeyEnv: "BLOOD_TEST_DEEPSEEK_KEY_DO_NOT_SET",
        defaultModel: "deepseek-chat"
      }
    },
    defaults: {
      storytellerProvider: "deepseek",
      aiPlayerProvider: "deepseek"
    },
    storyteller: {
      providerId: "deepseek",
      model: "deepseek-chat"
    }
  });
  const store = createRoomStore();
  const host = store.createRoom("Prompt Only", "Host");
  const service = createLlmService({
    configPath,
    fetchImpl: async () => {
      throw new Error("fetch should not be called without an API key");
    }
  });

  const result = await service.complete(store, host.roomId, host.clientId, host.token, {
    kind: "storyteller-advice",
    instruction: "下一步怎么主持？"
  });

  assert.equal(result.promptOnly, true);
  assert.match(result.prompt, /完整房间上下文 JSON/);
  assert.match(result.prompt, /下一步怎么主持/);
});

test("LLM service merges ignored local config overrides", async () => {
  const configPath = writeTempConfig({
    providers: {
      deepseek: {
        type: "openai-compatible",
        endpoint: "http://deepseek.test/chat",
        apiKeyEnv: "BLOOD_TEST_DEEPSEEK_KEY_DO_NOT_SET",
        defaultModel: "deepseek-chat"
      }
    },
    defaults: {
      storytellerProvider: "deepseek",
      aiPlayerProvider: "deepseek"
    },
    storyteller: {
      providerId: "deepseek",
      model: "deepseek-chat"
    }
  });
  const localConfigPath = writeTempConfig(
    {
      providers: {
        deepseek: {
          apiKey: "sk-local-test"
        }
      }
    },
    "llm.local.json"
  );
  const calls = [];
  const store = createRoomStore();
  const host = store.createRoom("Local Override", "Host");
  const service = createLlmService({
    configPath,
    localConfigPath,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "local-ok" } }] })
      };
    }
  });

  const result = await service.complete(store, host.roomId, host.clientId, host.token, {
    kind: "storyteller-advice",
    instruction: "真实请求测试"
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, "local-ok");
  assert.equal(calls[0].url, "http://deepseek.test/chat");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-local-test");
});

test("AI player LLM calls can route by role provider and remain context-isolated", async () => {
  const configPath = writeTempConfig({
    providers: {
      default: {
        type: "openai-compatible",
        endpoint: "http://default-provider.test/chat",
        apiKeyEnv: "",
        defaultModel: "default-model"
      },
      evil: {
        type: "openai-compatible",
        endpoint: "http://evil-provider.test/chat",
        apiKeyEnv: "",
        defaultModel: "evil-model"
      }
    },
    defaults: {
      storytellerProvider: "default",
      aiPlayerProvider: "default"
    },
    roleProviders: {
      imp: "evil"
    }
  });
  const calls = [];
  const service = createLlmService({
    configPath,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: `response-${calls.length}` } }] })
      };
    }
  });

  const store = createRoomStore();
  const host = store.createRoom("AI Routing", "Host");
  store.applyAction(host.roomId, host.clientId, host.token, "addAiPlayer", {
    name: "AI 小恶魔",
    persona: "会隐藏阵营。"
  });
  store.applyAction(host.roomId, host.clientId, host.token, "addAiPlayer", {
    name: "AI 镇民",
    persona: "会找矛盾。"
  });

  const state = store.getState(host.roomId, host.clientId, host.token);
  const demonAi = state.game.players.find((player) => player.name === "AI 小恶魔");
  const townAi = state.game.players.find((player) => player.name === "AI 镇民");
  store.applyAction(host.roomId, host.clientId, host.token, "updatePlayer", {
    playerId: demonAi.id,
    patch: { roleId: "imp", shownRoleId: "imp", alignment: "evil" }
  });
  store.applyAction(host.roomId, host.clientId, host.token, "updatePlayer", {
    playerId: townAi.id,
    patch: { roleId: "chef", shownRoleId: "chef", alignment: "good" }
  });

  const demonResult = await service.complete(store, host.roomId, host.clientId, host.token, {
    kind: "ai-public-chat",
    playerId: demonAi.id,
    instruction: "公开发言"
  });
  const townResult = await service.complete(store, host.roomId, host.clientId, host.token, {
    kind: "ai-public-chat",
    playerId: townAi.id,
    instruction: "公开发言"
  });

  assert.equal(demonResult.text, "response-1");
  assert.equal(townResult.text, "response-2");
  assert.equal(calls[0].url, "http://evil-provider.test/chat");
  assert.equal(calls[0].body.model, "evil-model");
  assert.equal(calls[1].url, "http://default-provider.test/chat");
  assert.equal(calls[1].body.model, "default-model");
  assert.notEqual(calls[0].body.messages, calls[1].body.messages);
  assert.equal(JSON.stringify(calls[1].body.messages).includes("response-1"), false);
});

function writeTempConfig(config, fileName = "llm.config.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blood-llm-"));
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}
