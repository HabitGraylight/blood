# 血染钟楼多人房间项目

这是一个多人房间制的网页游戏原型。第一目标不是做说书人看板，而是让多人进入同一个房间：真人说书人模式下房主担任说书人；LLM 说书人模式下房主只是玩家兼房间管理员，普通玩家只看到自己该看到的信息。

当前默认 LLM provider 是 DeepSeek，配置文件不会要求把真实 API Key 提交到仓库。项目带本地账号系统，用户数据保存在 `data/`，该目录被 `.gitignore` 排除。

## 目录结构

```text
config/         LLM provider 配置和本地配置样例
data/           服务器本地用户数据，默认不进 git
prompts/        说书人、AI 玩家、角色独立 prompt
src/
  client/        浏览器 UI
  server/        HTTP API、SSE、房间引擎
  shared/        前后端共享的板子/角色数据
test/            多玩家房间逻辑测试
```

根目录只保留项目入口和说明文件。

## 启动

```bash
npm start
```

默认地址：

```text
http://127.0.0.1:8000/
```

## LLM 配置

默认 provider 是 `deepseek`：

```json
{
  "endpoint": "https://api.deepseek.com/chat/completions",
  "apiKeyEnv": "DEEPSEEK_API_KEY",
  "defaultModel": "deepseek-v4-flash"
}
```

推荐二选一配置密钥：

```bash
export DEEPSEEK_API_KEY="sk-..."
```

或复制本地覆盖文件：

```bash
cp config/llm.local.example.json config/llm.local.json
```

然后在 `config/llm.local.json` 填真实 key。这个文件已加入 `.gitignore`，不会被提交。服务启动时会先读取 `config/llm.config.json`，再合并本地覆盖文件。

Prompt 独立放在 `prompts/`：

- `prompts/storyteller/system.md`：LLM 说书人系统提示。
- `prompts/storyteller/advice.md`：说书人建议请求模板。
- `prompts/ai-player/system.md`：AI 玩家通用系统提示。
- `prompts/ai-player/public-chat.md`：AI 玩家公开发言模板。
- `prompts/roles/{roleId}.md`：角色专属提示；没有专属文件时走 `prompts/roles/default.md`。

每个角色可以在 `config/llm.config.json` 的 `roleProviders` 指向不同 provider。每个 AI 玩家也可以在前端填独立 `providerId`；即使复用同一个 provider，每次请求也只发送该 AI 当前可见上下文，不共享其他 AI 的对话上下文。

前端“AI 智慧程度”对应 `config/llm.config.json` 的 `modelPresets`：

- `flash`：`deepseek-v4-flash`，低推理成本，适合普通 AI 玩家发言。
- `pro`：`deepseek-v4-pro`，标准质量，适合说书人建议。
- `pro-reasoning`：`deepseek-v4-pro` + thinking enabled + high reasoning effort，适合复杂裁定。

当前开发环境如果设置了 `HTTPS_PROXY`，Node 内置 `fetch` 可能不自动走代理。服务端会先尝试 `fetch`，失败后在 `transport: "auto"` 下使用 `curl` fallback，因此本地代理环境也能连 DeepSeek。

LLM 说书人 prompt 内置了平衡裁定原则：当规则允许说书人处理概率事件、错误信息、重定向、替死、角色误判或死亡选择时，模型会先参考存活善恶人数、恶魔压力、投票门槛、死亡节奏和角色信息量，再给推荐裁定与备选裁定。确定性规则不会因为“平衡”被改写。

LLM 说书人模式下，房主仍是玩家。服务端会对玩家房主可见的 LLM 回复做隐藏角色名脱敏；如果 provider 未完整配置，也不会导出包含隐藏魔典的完整 prompt。

## 用户系统与持久化

- 玩家需要注册/登录后才能创建或加入房间。
- 账号数据默认保存在 `data/users.json`。
- 密码使用 PBKDF2 + salt 存储，session token 只保存 hash。
- `data/` 已加入 `.gitignore`。部署时更新代码、拉取新版本或推送 GitHub 都不会上传用户数据。
- 如果要把用户数据放到项目外，可以设置环境变量：

```bash
BLOOD_DATA_DIR=/srv/blood-data npm start
```

## 当前游戏流程

1. 房主注册或登录账号后，输入房间名创建房间。
2. 进入页负责登录、注册、创建房间、加入房间。
3. 准备页负责邀请玩家、选择真人/LLM 说书人、选择 AI 智慧程度、补 AI 玩家、抽角色、发牌。
4. 游戏页负责城镇广场、夜晚顺序、提名投票、身份卡和说书人操作。
5. 社交页负责公开发言、私聊房和说书人私信。
6. 真人说书人模式下，房主可以看到魔典；LLM 说书人模式下，房主只能看到自己的身份。

## AI 玩家

- 房主可以添加 AI 玩家，并设置名字和性格/策略。
- AI 玩家是正式玩家，会占座、参与发牌、出现在提名和投票列表里。
- 房主选中 AI 玩家后，可用“让选中 AI 发言”生成公开发言。
- AI 发言复用 OpenAI 兼容 LLM 接口；默认 DeepSeek，前端只可选择 `providerId` 和模型覆盖。未配置密钥时会复制提示词，方便手动粘贴到模型。
- 普通玩家不能冒充 AI 玩家发言。

## 角色头像与 DIY

- 默认 Trouble Brewing Lite 角色都带有独立头像符号、底色和强调色。
- 头像数据保存在角色 JSON 的 `avatar` 字段中，例如 `{ "symbol": "卜", "background": "#5a4c85", "accent": "#d7c4ff" }`。
- 房主可在“板子编辑”里修改角色头像；导入自定义板子时，没有头像的角色会自动用角色名和阵营色生成回退头像。

## 测试

```bash
npm run check
npm test
node test/room-flow.test.js
node test/llm-service.test.js
```

测试覆盖：

- 多个玩家同时加入同一个房间。
- HTTP API 需要登录账号才能创建或加入房间。
- 用户账号能持久化到 `data/users.json`，且不会暴露密码明文或 session token 明文。
- 普通玩家不能执行房主设置操作。
- 房主自动抽角色、随机发牌、开始首夜。
- 普通玩家只能看到自己的身份，看不到其他人的隐藏阵营/角色。
- LLM 说书人模式下，房主是玩家视角，不能查看或手动修改魔典。
- AI 玩家加入、发牌、房主驱动 AI 发言，以及普通玩家不能冒充 AI。
- LLM 说书人上下文包含平衡快照，默认板子每个角色都有头像数据。
- LLM 说书人模式下，玩家房主收到的模型输出会经过隐藏身份脱敏。
- 私聊房消息只对成员可见；真人说书人可以审计私聊。
- SSE 订阅者能收到加入和阶段推进更新。

## 当前限制

- 房间状态仍然是内存存储，服务重启会清空。
- 没有账号系统，房主身份依赖浏览器本地保存的 token。
- 角色能力仍由房主裁定，暂未做自动裁判。
- 私聊目前是文本记录，不是语音/视频。

下一步建议优先做持久化、玩家换座/认领空座、角色能力钩子和更清晰的夜晚行动向导。

## 开源协议

MIT License。详见 `LICENSE`。
