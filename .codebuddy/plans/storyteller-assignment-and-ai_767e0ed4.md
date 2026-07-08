---
name: storyteller-assignment-and-ai
overview: 在多人联机等待房间中，允许房主将说书人职位交给任意玩家，或切换为AI说书人模式。涉及firebaseSession.js元数据扩展、startGame逻辑改造、远程说书人动作处理、_publish视图分发、RoomScreen UI和GameScreen权限调整。
todos:
  - id: extend-firebase-meta
    content: 扩展 firebaseSession.js：meta 增加 storytellerMode 字段，新增 setStoryteller/setAIStoryteller 方法，重构 startGame 支持三种说书人模式
    status: completed
  - id: refactor-publish-and-actions
    content: 重构 firebaseSession.js 的 _publish 和 _handleRemoteAction：委托说书人时发布 storytellerView 到对应玩家，新增 storytellerAction 远程动作处理；GuestSession 新增 pushStorytellerAction 方法
    status: completed
    dependencies:
      - extend-firebase-meta
  - id: update-room-screen-ui
    content: 改造 RoomScreen.jsx：新增说书人模式切换控件（人类/AI切换按钮）、玩家列表中说书人徽章和"设为说书人"按钮、当前说书人信息展示
    status: completed
    dependencies:
      - extend-firebase-meta
  - id: update-game-screen-permissions
    content: 调整 GameScreen.jsx 权限判断：宣布黄昏按钮的 isHost 检查改为 isHost 或 isStoryteller，确保委托说书人也可见操作按钮
    status: completed
    dependencies:
      - refactor-publish-and-actions
  - id: update-lobby-hint
    content: 更新 MultiLobbyScreen.jsx 创建房间提示文案，反映说书人可转让和AI可选的新特性
    status: completed
---

## 用户需求

当前多人联机模式默认将房主设为说书人（不占玩家座位），现需改为支持三种说书人模式：

1. 房主自己当说书人（当前默认行为）
2. 房主将说书人职位交给等待房间中的任意一位玩家
3. 选择AI说书人模式，由AI自动裁定游戏

## 核心功能

- **说书人转让**：房主在等待房间可点击任意玩家将其设为说书人，原说书人（如果是玩家）回到玩家列表
- **AI说书人切换**：房主可通过一键切换按钮选择AI说书人模式，此时房主也变为普通玩家参与游戏
- **说书人状态展示**：等待房间顶部清楚显示当前说书人是人类玩家还是AI
- **权限适配**：被转让的说书人玩家进入游戏后能看到完整StorytellerConsole控制台，可执行所有说书人操作（裁定、旁白、推进阶段、宣布黄昏等）
- **房主管理权保留**：房主始终保留管理权（移除玩家、开始游戏等），与说书人身份解耦

## 技术栈

- 前端框架：React (JSX)
- 状态管理：React useState + session subscribe 模式
- 后端：Firebase Realtime Database
- 引擎：GameEngine + GameCore + AIStoryteller

## 实现方案

### 核心策略：房主与说书人身份解耦

当前架构中 `FirebaseHostSession` 同时承担"房主"（管理房间）和"说书人"（主持游戏）两个角色。本次改造将两个身份分离：

- **房主 (host)**：始终是房间创建者，负责管理房间（添加/移除玩家、开始游戏、分配说书人），其 uid 存储在 `meta.hostUid`
- **说书人 (storyteller)**：可以是房主、任意玩家、或AI，负责主持游戏，其身份存储在 `meta.storytellerUid` 和 `meta.storytellerMode` 中

### 三种模式的数据流转

**模式一：房主说书人（当前行为，保持兼容）**

- `storytellerMode = "human"`, `storytellerUid = host.uid`
- 房主不在 lobby 中，`mySeat = -1`
- GameCore 以 `storytellerId: host.uid` 创建

**模式二：委托说书人（新增）**

- `storytellerMode = "human"`, `storytellerUid = 玩家A的uid`
- 房主加入 lobby 作为普通玩家，玩家A从 lobby 移除
- GameCore 以 `storytellerId: 玩家A的uid` 创建
- Host 的 `_publish()` 将 storytellerView 发布到 `views/{玩家A的uid}`
- 玩家A通过 FirebaseGuestSession 收到 storytellerView，GameScreen 渲染 StorytellerConsole
- 玩家A的说书人操作通过 `kind: "storytellerAction"` 发送到 Firebase，Host 的 `_handleRemoteAction` 处理

**模式三：AI说书人（新增）**

- `storytellerMode = "ai"`, `storytellerUid = ""`
- 房主加入 lobby 作为普通玩家
- GameCore 以 `aiStoryteller: true` 创建，无 `storytellerId`
- AI autopilot 始终开启，所有裁定由 AIStoryteller 自动处理

### 关键架构决策

- **GameCore 始终运行在房主设备上**：这是当前 Firebase 联机架构的基础约束，房主设备是唯一权威的游戏状态源
- **委托说书人的操作通过 Firebase 中转**：远程说书人发送 `storytellerAction` 到 Firebase actions 节点，房主的 `_handleRemoteAction` 接收并调用 `GameCore.dispatchStoryteller()`
- **房主身份判断**：`GameScreen` 中 `session.isHost` 用于房主专属操作（如宣布黄昏），委托模式下说书人（非房主）也需要这些权限，因此将判断改为 `session.isHost || view.isStoryteller`

## 实现细节

### 性能考量

- Meta 变更仅更新单个字段，使用 `fb.update` 避免覆盖整个 meta 节点
- 说书人转让时 lobby 变更使用原子 update 操作（添加一人+移除一人），保证一致性
- _publish() 中新增的 storytellerView 发布与现有旁观者/玩家视图发布合并到同一次 update 调用

### 边界情况处理

- 切换到 AI 模式时，如果当前说书人是其他玩家，该玩家自动回到 lobby
- 从 AI 切换回人类模式时，默认说书人恢复为房主
- 委托的说书人离开房间时，meta 自动恢复为房主说书人（由 `onDisconnect` 或手动处理）
- 人数校验：被转让的说书人不占玩家座位，AI 模式时房主占一个座位，总玩家数仍必须满足 5-15