/**
 * AI 玩家提示词构建。
 * 全部基于 playerView 投影 —— AI 只能"看到"同座位真人玩家能看到的信息,
 * 从机制上杜绝 AI 作弊。
 *
 * 行为准则与角色策略来自 prompts/ 目录的 markdown 文件,可直接编辑调优:
 * - prompts/ai-player/system.md   通用玩家行为准则
 * - prompts/ai-player/public-chat.md  公开发言任务模板
 * - prompts/roles/{scriptId}/{roleId}.md  按剧本的角色策略;
 *   回退顺序: {scriptId}/{roleId}.md → {roleId}.md → {scriptId}/default.md → default.md
 */
import { getScript, roleName as scriptRoleName, TEAM_LABELS } from "../scripts/registry.js";

// Vite 在构建时把 markdown 内容内联进来(含剧本子目录)
const roleDocs = import.meta.glob("../../prompts/roles/**/*.md", {
  eager: true, query: "?raw", import: "default"
});
const playerDocs = import.meta.glob("../../prompts/ai-player/*.md", {
  eager: true, query: "?raw", import: "default"
});
const storytellerDocs = import.meta.glob("../../prompts/storyteller/*.md", {
  eager: true, query: "?raw", import: "default"
});

function roleDoc(scriptId, roleId) {
  return (
    roleDocs[`../../prompts/roles/${scriptId}/${roleId}.md`] ||
    roleDocs[`../../prompts/roles/${roleId}.md`] ||
    roleDocs[`../../prompts/roles/${scriptId}/default.md`] ||
    roleDocs["../../prompts/roles/default.md"] ||
    ""
  ).trim();
}

const PLAYER_SYSTEM = (playerDocs["../../prompts/ai-player/system.md"] || "").trim();
const PUBLIC_CHAT_TEMPLATE = (playerDocs["../../prompts/ai-player/public-chat.md"] || "").trim();

function rulesBriefForScript(scriptId) {
  const script = getScript(scriptId);
  return script.rulesBrief || [
    `Rules brief for ${script.name}:`,
    "- Good usually wins by executing the demon; evil usually wins when only two players are alive.",
    "- Day is for discussion, nominations, and voting; night actions follow the script night order.",
    "- Information can be unreliable because of abilities, statuses, or storyteller rulings."
  ].join("\n");
}

const REASONING_BRIEF = `发言前在心里完成推理,不要把步骤逐条输出:
1. 事实抽取:先列出每名玩家的公开身份声明、能力信息、投票/提名、否认或改口,只使用上下文中出现过的内容。
2. 声称审计:对照 <role_whitelist> ——角色名不在白名单里,这是重大邪恶信号,应当公开质疑;再对照 <known_role_abilities>(附在声称角色后面的真实能力),如果某人声称的角色能力与官方能力不一致,同样是关键信号;再对照 <player_count_config> 数一数各类声称数量,外来者声称超编可能说明有设置修正角色在场。
3. 约束合并:把"二选一/至少一人/没有命中/确认某角色"等信息当作逻辑约束合并;如果一个候选被另一条可信信息支持,压力会转移到同组另一端。
4. 假设分支:分别考虑"这条信息真""这条信息假或受误导""说话者在撒谎"三种分支,不要只挑对自己方便的一支。
5. 死亡线索:恶魔倾向夜杀信息型角色。某人公开关键信息后当晚被杀,他的信息可信度上升;自称信息位却一直活到残局、从不被刀的人反而更可疑。
6. 反证检查:结论出手前,检查它是否与已公开身份、已死亡名单、自己此前发言或最新回应冲突。
7. 置信表达:证据链完整时可以明确推动;只有部分线索时用怀疑、追问或条件句;邪恶玩家可以撒谎,但谎言也要自洽。`;

/** 角色名白名单:仅名字,不含能力(每条约5 token)。用于AI假名检测,共享缓存块安全合法。 */
function scriptRoleNameWhitelist(view) {
  const script = getScript(view.scriptId);
  const byTeam = new Map();
  for (const r of Object.values(script.roles)) {
    if (!byTeam.has(r.team)) byTeam.set(r.team, []);
    byTeam.get(r.team).push(r.name);
  }
  const lines = [`《${script.name}》全部合法角色名:`];
  for (const [team, names] of byTeam) {
    lines.push(`  ◆ ${TEAM_LABELS[team]}: ${names.join("、")}`);
  }
  return lines.join("\n");
}

/** RAG按需注入:只注入「自己角色 + 公开声称过的角色 + 邪恶伪装池」的能力文本,替代原先全量角色表(~1500+token) */
function scriptRolesBriefRAG(view, chatHistory) {
  const script = getScript(view.scriptId);
  const roleSet = new Set();

  // 1. 自己的角色
  roleSet.add(view.you.role);

  // 2. 公开声称过的角色(复用 buildClaimAudit 的提取逻辑)
  if (chatHistory && chatHistory.length) {
    const names = Object.values(script.roles).map((r) => r.name);
    const claimRe = new RegExp(`(?:我是|我就是|我跳|我报|自[认称]|身份是|真)(${names.join("|")})`);
    const publicChats = chatHistory.filter((c) => c.to == null);
    const nameToId = new Map(Object.entries(script.roles).map(([id, r]) => [r.name, id]));
    for (const c of publicChats) {
      for (const m of (String(c.text || "")).matchAll(new RegExp(claimRe, "g"))) {
        const rid = nameToId.get(m[1]);
        if (rid) roleSet.add(rid);
      }
    }
  }

  // 3. 邪恶伪装池
  if (view.you.evilInfo && Array.isArray(view.you.evilInfo.bluffs)) {
    for (const b of view.you.evilInfo.bluffs) roleSet.add(b);
  }

  if (roleSet.size === 0) return "";

  const byTeam = new Map();
  for (const rid of roleSet) {
    const r = script.roles[rid];
    if (!r) continue;
    if (!byTeam.has(r.team)) byTeam.set(r.team, []);
    byTeam.get(r.team).push(`${r.name}: ${r.ability}${r.clarify ? `【要点:${r.clarify}】` : ""}`);
  }

  const lines = ["以下是你已知在局角色或公开被声称角色的真实能力。核对他人声称时以这里为准:"];
  for (const [team, roles] of byTeam) {
    lines.push(`  ◆ ${TEAM_LABELS[team]}:`, ...roles.map((r) => `    - ${r}`));
  }
  return lines.join("\n");
}

/** 剧本角色速查表(保留为兼容回退,新代码用 scriptRoleNameWhitelist + scriptRolesBriefRAG) */
function scriptRolesBrief(view) {
  const script = getScript(view.scriptId);
  const byTeam = new Map();
  for (const r of Object.values(script.roles)) {
    if (!byTeam.has(r.team)) byTeam.set(r.team, []);
    byTeam.get(r.team).push(`${r.name}: ${r.ability}${r.clarify ? `【要点: ${r.clarify}】` : ""}`);
  }
  const lines = [
    `【剧本角色表】《${script.name}》全部角色,以下是本局唯一合法的角色名与能力。提到任何角色时必须使用这里的准确名称;有人声称的角色不在此表、或把能力说成别的样子,几乎可以断定他在撒谎:`
  ];
  for (const [team, roles] of byTeam) {
    lines.push(`◆ ${TEAM_LABELS[team]}:`, ...roles.map((r) => `  - ${r}`));
  }
  return lines.join("\n");
}

/** 其它桌游/剧本里常见、但本剧本不存在的角色叫法由脚本数据提供。 */

/**
 * 身份声称对照审计:从公开发言里提取每个人声称过的角色,
 * 附上剧本真实能力,并标记不存在的角色名 —— 在代码里做匹配,不指望模型自己回忆。
 */
export function buildClaimAudit(view, chatHistory) {
  const script = getScript(view.scriptId);
  const names = Object.values(script.roles).map((r) => r.name);
  const claimRe = new RegExp(`(?:我是|我就是|我跳|我报|自[认称]|真)(${names.join("|")})`);
  const publicChats = (chatHistory || []).filter((c) => c.to == null);
  const claims = new Map(); // seat -> Set(roleName)
  const foreign = new Map(); // seat -> Set(word)

  for (const c of publicChats) {
    if (c.fromSeat == null) continue;
    const text = String(c.text || "");
    for (const m of text.matchAll(new RegExp(claimRe, "g"))) {
      if (!claims.has(c.fromSeat)) claims.set(c.fromSeat, new Set());
      claims.get(c.fromSeat).add(m[1]);
    }
    for (const w of (script.foreignRoleWords || [])) {
      if (text.includes(w)) {
        if (!foreign.has(c.fromSeat)) foreign.set(c.fromSeat, new Set());
        foreign.get(c.fromSeat).add(w);
      }
    }
  }
  if (!claims.size && !foreign.size) return "";

  const byName = new Map(Object.values(script.roles).map((r) => [r.name, r]));
  const lines = ["身份声称对照(由发言自动提取;能力以剧本角色表为准):"];
  for (const [seat, set] of claims) {
    const s = view.seats[seat];
    for (const rn of set) {
      const r = byName.get(rn);
      lines.push(`  - ${seatNo(seat)}号 ${s ? s.name : "?"} 声称「${rn}」→ 真实能力: ${r.ability}${r.clarify ? ` (${r.clarify})` : ""}`);
    }
  }
  for (const [seat, set] of foreign) {
    const s = view.seats[seat];
    lines.push(`  - ${seatNo(seat)}号 ${s ? s.name : "?"} 的发言里出现了本剧本不存在的角色名: ${[...set].join("、")}`);
  }
  return lines.join("\n");
}

/** 人数配置与外来者核算 */
function compositionBrief(view) {
  const script = getScript(view.scriptId);
  const n = view.seats.length;
  const base = script.setupTable && script.setupTable[n];
  if (!base) return "";
  const lines = [`${n}人局标准配置: 村民${base.townsfolk}、外来者${base.outsider}、爪牙${base.minion}、恶魔${base.demon}。`];
  const modifiers = Object.values(script.roles).filter((role) => role.setupModifier);
  for (const role of modifiers) {
    const changed = { ...base };
    for (const [team, delta] of Object.entries(role.setupModifier)) changed[team] = Math.max(0, (changed[team] || 0) + delta);
    lines.push(`若${role.name}在场则改为: 村民${changed.townsfolk ?? 0}、外来者${changed.outsider ?? 0}、爪牙${changed.minion ?? 0}、恶魔${changed.demon ?? 0}。`);
  }
  return lines.join("\n");
}

/**
 * 安全断言:共享缓存块文本不得包含任何玩家私密标记。
 * 与旧版不同 — 玩家名/座位号在公开聊天中合法,不再视为泄露。
 * @param {string} sharedText 共享缓存块合并文本
 * @param {string[]} whitelistedRoleNames 剧本全部角色名(白名单内不触发能力文本检测)
 */
export function assertNoLeak(sharedText, whitelistedRoleNames = []) {
  const secretPatterns = [
    // 玩家私密 XML 标签:这些标签绝不应出现在共享缓存块中
    { re: /<your_seat>/, label: "<your_seat> 玩家身份标签" },
    { re: /<your_identity>/, label: "<your_identity> 能力标签" },
    { re: /<evil_info>/, label: "<evil_info> 邪恶情报标签" },
    { re: /<bluffs>/, label: "<bluffs> 伪装标签" },
    { re: /<private_log>/, label: "<private_log> 私密日志标签" },
    { re: /<memo>/, label: "<memo> 推理档案标签" },
    { re: /<persona>/, label: "<persona> 性格标签" },
    // <known_role_abilities> 和 <role_strategy> 在 REASONING_BRIEF 中作为合法引用出现,不视为泄露
    // 纯文本私密标记(兜底)
    { re: /^你是\s*\d+号/m, label: "「你是N号」行首指代" },
    { re: /^你的(身份|能力|角色)[是为]/m, label: "「你的身份/能力/角色」行首" },
  ];

  for (const { re, label } of secretPatterns) {
    if (re.test(sharedText)) {
      const match = sharedText.match(re);
      throw new Error(
        `assertNoLeak: 共享缓存块中发现私密标记 "${label}"` +
        (match ? ` → "${match[0].slice(0, 60)}"` : "") +
        `。请将其移到动态块(Block 3)中。`
      );
    }
  }

  // 能力文本检测:共享块不应包含角色能力详情(白名单纯名字OK)
  const abilityPatterns = [
    /[：:]\s*你\s*(每晚|可以|选择|能够)/,
    /【要点:/,
    /真实能力:/,
  ];
  // 构造白名单名字的正则,用于排除误报
  const nameSet = new Set(whitelistedRoleNames);
  for (const p of abilityPatterns) {
    if (p.test(sharedText)) {
      throw new Error(
        `assertNoLeak: 共享缓存块中发现角色能力描述文本 —— 角色能力属于私密信息,请将其移到动态块(Block 3)或RAG检索中。`
      );
    }
  }

  return true;
}

/** 对玩家展示的座位号统一为 1 号起(与游戏界面一致);引擎内部仍是 0 起 */
function seatNo(seat) {
  return seat + 1;
}

/**
 * 渲染 AI 的推理档案(结构化长期记忆)。
 * 新格式: { updatedDay, players: {座位号: 一行描述}, self, plan }
 * 兼容旧格式: { updatedDay, summary }
 */
function renderMemo(view, memo) {
  if (!memo) return "";
  if (memo.players && typeof memo.players === "object") {
    const lines = [`你自己维护的工作记忆,截至第${memo.updatedDay}天:`];
    for (const s of view.seats) {
      const note = memo.players[String(seatNo(s.seat))] || memo.players[seatNo(s.seat)];
      if (note) lines.push(`  - ${seatNo(s.seat)}号 ${s.name}${s.alive ? "" : "(已死)"}: ${String(note).slice(0, 80)}`);
    }
    if (memo.self) lines.push(`  - 你自己的声称/承诺: ${String(memo.self).slice(0, 80)}`);
    if (memo.plan) lines.push(`  - 你的计划与首要怀疑: ${String(memo.plan).slice(0, 100)}`);
    return lines.length > 1 ? lines.join("\n") : "";
  }
  if (memo.summary) {
    return `长期记忆(截至第${memo.updatedDay}天):\n${memo.summary}`;
  }
  return "";
}

function seatLine(s) {
  const tags = [];
  if (!s.alive) tags.push(s.ghostVote ? "死亡·有遗书票" : "死亡·无投票权");
  return `${seatNo(s.seat)}号 ${s.name}${tags.length ? ` (${tags.join(",")})` : ""}`;
}

/** 按天数给出宏观阶段建议 */
function stageAdvice(view) {
  const alive = view.seats.filter((s) => s.alive).length;
  if (alive <= 4) return "残局:每一票都决定胜负。善良应公开全部信息拼死推理;邪恶要争取误导最后的处决。";
  if (view.day <= 1) return "第一天:信息还少。信息型角色通常先观察、少暴露;可试探他人口风,注意谁急于带节奏。";
  return "中期:开始交叉验证各方声明,揪出前后矛盾;掌握关键信息的善良角色可考虑公开换取信任。";
}

/**
 * 关键数字与残局警告:全部在代码里算好,不依赖模型心算。
 * 只剩两名存活玩家时邪恶获胜,因此 3 人局的白天就是善良最后的机会。
 * 剧本专属的残局建议(涉及具体角色的措辞)由 script.reference.endgameHints 提供。
 */
function tempoBrief(view) {
  const alive = view.seats.filter((s) => s.alive).length;
  const execLine = Math.ceil(alive / 2);
  const script = getScript(view.scriptId);
  const hints = script.reference?.endgameHints || {};
  const lines = [`存活 ${alive} 人;处决需要至少 ${execLine} 票且为当日最高票。场上只剩 2 名存活玩家时邪恶立即获胜。`];
  if (alive === 3) {
    lines.push(
      "只剩 3 人,恶魔几乎必在其中(除非它已死)。今天不处决任何人、或处决了好人 → 入夜后恶魔杀 1 人只剩 2 人,邪恶立即获胜。善良阵营:今天必须处决恶魔,这是唯一也是最后的机会。" +
        (hints.three || "")
    );
  } else if (alive === 4) {
    lines.push(
      "只剩 4 人,恶魔就在其中。今天处决错人,明晚恶魔再杀 1 人只剩 2 人,邪恶获胜——今天基本是善良最后一次纠错机会。" +
        (hints.four || "")
    );
  } else if (alive === 5) {
    lines.push("只剩 5 人。若今天不处决,入夜再死 1 人就进入 4 人残局,善良容错只剩一次。");
  }
  if (view.phase === "day" && alive > 5) {
    lines.push(
      "白天的处决是善良阵营唯一的主动进攻手段;一天不处决,等于白送邪恶一个夜晚。" +
        (hints.pace || "")
    );
  }
  return lines.join("\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function claimPatternsFor(view) {
  const script = getScript(view?.scriptId);
  const roleWords = Object.values(script.roles).map((r) => escapeRegExp(r.name)).join("|");
  return [
    { label: "身份声明", re: new RegExp(`我是|我跳|我报|身份|${roleWords}`) },
    { label: "能力信息", re: /查了|查的|查到|得知|信息|有恶魔|没有恶魔|有爪牙|好人|坏人|邪恶|善良|两人中|其中/ },
    { label: "指控/投票", re: /说谎|撒谎|恶魔|爪牙|可疑|假跳|冒充|投票|提名|处决/ },
    { label: "否认/改口", re: /没说过|我没说|不是我说|听岔|记错|忘了|改口|撤回|重新说/ }
  ];
}
function compactQuote(text, max = 90) {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine;
}

function claimLabels(text, view) {
  return claimPatternsFor(view).filter((p) => p.re.test(text)).map((p) => p.label);
}

function playerLabel(c) {
  return `${c.fromSeat != null ? `${seatNo(c.fromSeat)}号 ` : ""}${c.fromName || "?"}`;
}

function mentionsPairInfo(text) {
  return /(两人|二人|两个|其中|中|里).*(有|至少).*(爪牙|恶魔|邪恶)/.test(text) || /\d+\s*(和|与|、)\s*\d+.*(有|至少).*(爪牙|恶魔|邪恶)/.test(text);
}

export function buildPublicClaimSummary(view, chatHistory) {
  const publicChats = (chatHistory || []).filter((c) => c.to == null).slice(-120);
  if (!publicChats.length) return "";

  const byPlayer = new Map();
  const selfLines = [];
  let hasPairInfo = false;

  for (const c of publicChats) {
    const labels = claimLabels(c.text || "", view);
    if (!labels.length) continue;
    if (mentionsPairInfo(c.text || "")) hasPairInfo = true;
    const key = c.fromSeat != null ? c.fromSeat : c.fromName || "?";
    const line = `${labels.join("/")}: "${compactQuote(c.text)}"`;
    const entry = byPlayer.get(key) || { name: playerLabel(c), lines: [] };
    entry.lines.push(line);
    if (entry.lines.length > 5) entry.lines.shift();
    byPlayer.set(key, entry);
    if (c.fromSeat === view.seat) selfLines.push(`- ${line}`);
  }

  const lines = [
    "最近约120条公开发言摘要(原话,不要改写成相反意思):",
    ...[...byPlayer.values()].map((entry) => `  - ${entry.name}: ${entry.lines.join("; ")}`)
  ];
  if (hasPairInfo) lines.push("推理提醒:二选一或至少一人命中的信息,不能转述成两人都是、两人都说谎或两人都邪恶。");
  if (selfLines.length) lines.push("你自己此前公开说过:", ...selfLines.slice(-8));
  return lines.join("\n");
}

/**
 * 构建共享系统提示块(Block1 + Block2),带 assertNoLeak 安全断言与 cache_control 断点。
 * 返回 Anthropic 兼容的 system block 数组。所有AI玩家可共享,绝不含任何玩家私密。
 * @param {object} view playerView
 * @param {Array} chatHistory 聊天记录
 * @returns {Array<{type:string, text:string, cache_control?:object}>}
 */
export function buildSharedSystemBlocks(view, chatHistory) {
  const script = getScript(view.scriptId);
  const whitelistNames = Object.values(script.roles).map((r) => r.name);

  // Block 1: 静态公共内容 + 历史每日摘要(整天稳定不变)
  // 每个语义块用 XML 标签隔离,降低模型混淆/幻觉
  const parts = [
    `<behavior_rules>\n${PLAYER_SYSTEM}\n</behavior_rules>`,
    `<script_rules>\n${rulesBriefForScript(view.scriptId)}\n</script_rules>`,
    `<role_whitelist>\n${scriptRoleNameWhitelist(view)}\n</role_whitelist>`,
    compositionBrief(view) ? `<player_count_config>\n${compositionBrief(view)}\n</player_count_config>` : "",
    `<reasoning_method>\n${REASONING_BRIEF}\n</reasoning_method>`,
  ];

  // 注入历史每日摘要
  if (view.dailySummaries && view.dailySummaries.length) {
    const summaryLines = view.dailySummaries.map((s) => `  - 第${s.day}天: ${s.text}`);
    parts.push(`<daily_summaries>\n${summaryLines.join("\n")}\n</daily_summaries>`);
  }

  const block1Text = parts.filter(Boolean).join("\n\n");

  // 安全断言:共享缓存块不得包含任何玩家私密标记
  assertNoLeak(block1Text, whitelistNames);

  return [
    { type: "text", text: block1Text, cache_control: { type: "ephemeral" } },
  ];
}

/**
 * 构建当天公开聊天块(放入 user 消息,避免 MiniMax 对 system 段的严格内容审核触发 new_sensitive)。
 * 返回纯文本字符串,调用方拼入 user 消息中。
 */
export function buildPublicChatBlock(chatHistory) {
  const publicChats = (chatHistory || []).filter((c) => c.to == null);
  if (!publicChats.length) return "";
  const chatLines = publicChats.map((c) => {
    const who = `${c.fromSeat != null ? `${seatNo(c.fromSeat)}号 ` : ""}${c.fromName}`;
    return `  ${who}: ${c.text}`;
  });
  return `<public_chat>\n${chatLines.join("\n")}\n</public_chat>`;
}

/**
 * 构建玩家专属系统提示块(Block3)——含身份、能力、角色策略、RAG检索、私密信息等。
 * 返回 Anthropic 兼容的 system block 数组,不进行缓存(每AI独有,永不共享)。
 * @param {object} view playerView
 * @param {string} persona 性格设定
 * @param {object|null} memo 长期记忆
 * @param {Array} chatHistory 聊天记录(用于RAG检索)
 * @returns {Array<{type:string, text:string}>}
 */
export function buildPlayerSystemBlocks(view, persona, memo, chatHistory) {
  const you = view.you;
  const parts = [
    `<your_seat>你是 ${seatNo(view.seat)}号玩家「${view.name}」(座位号从1开始,与座位表一致)</your_seat>`,
    `<your_identity>\n  身份: ${you.roleName}(${you.teamLabel},${you.alignmentLabel}阵营)\n  能力: ${you.ability}\n  ${you.alive ? "" : "你已死亡" + (you.ghostVote ? ",还有一次遗书票" : ",无法再投票")}\n</your_identity>`,
  ];

  // RAG 检索
  const ragRoles = scriptRolesBriefRAG(view, chatHistory);
  if (ragRoles) parts.push(`<known_role_abilities>\n${ragRoles}\n</known_role_abilities>`);

  parts.push(
    `<role_strategy>\n${roleDoc(view.scriptId, you.role)}\n</role_strategy>`,
    `<stage_advice>${stageAdvice(view)}</stage_advice>`
  );

  if (you.evilInfo) {
    const demon = view.seats[you.evilInfo.demonSeat];
    const minions = you.evilInfo.minionSeats.map((s) => `${seatNo(s)}号 ${view.seats[s].name}`);
    parts.push(`<evil_info>恶魔是 ${seatNo(you.evilInfo.demonSeat)}号 ${demon.name}${minions.length ? "; 爪牙: " + minions.join("、") : ""}</evil_info>`);
    if (you.evilInfo.bluffs && you.evilInfo.bluffs.length) {
      const script = getScript(view.scriptId);
      parts.push(`<bluffs>${you.evilInfo.bluffs.map((id) => scriptRoleName(script, id)).join("、")}</bluffs>`);
    }
  }

  if (you.privateLog.length) {
    const logLines = you.privateLog.map((l) => `  - [第${l.night}夜] ${l.text}`);
    parts.push(`<private_log>\n${logLines.join("\n")}\n</private_log>`);
  }

  const memoBlock = renderMemo(view, memo);
  if (memoBlock) parts.push(`<memo>\n${memoBlock}\n</memo>`);

  parts.push(`<persona>${persona || "冷静理性,善于观察"}</persona>`);

  const block3Text = parts.filter(Boolean).join("\n\n");
  return [{ type: "text", text: block3Text }];
}

/** 兼容包装:拼接共享块+玩家块为单一字符串(供测试/回退使用,不启用缓存) */
export function buildSystemPrompt(view, persona, memo = null) {
  const shared = buildSharedSystemBlocks(view, []);
  const player = buildPlayerSystemBlocks(view, persona, memo, []);
  const chat = buildPublicChatBlock([]);
  return [...shared, ...player].map((b) => b.text).concat(chat ? [chat] : []).join("\n");
}

/** 构建当前局面描述 */
export function buildSituation(view, chatHistory) {
  const aliveSeats = view.seats.filter((s) => s.alive);
  const deadSeats = view.seats.filter((s) => !s.alive);

  const parts = [
    `<current_state>第 ${view.day} 个白天,存活 ${aliveSeats.length} 人。</current_state>`,
    `<seat_table>\n${view.seats.map(seatLine).join("\n")}\n</seat_table>`,
    `<alive_players>${aliveSeats.map((s) => `${seatNo(s.seat)}号 ${s.name}`).join("、")}</alive_players>`,
  ];

  if (deadSeats.length) {
    parts.push(`<dead_players>${deadSeats.map((s) => `${seatNo(s.seat)}号 ${s.name}`).join("、")} —— 死者不能被提名、处决或作为投票对象</dead_players>`);
  }

  if (view.onBlock && view.onBlock.seat != null) {
    parts.push(`<execution_block>处决台上: ${view.seats[view.onBlock.seat].name} (${view.onBlock.votes}票)</execution_block>`);
  }

  if (view.nominations.length) {
    const nomLines = view.nominations.map(
      (n) => `  ${view.seats[n.nominator].name} 提名 ${view.seats[n.nominee].name}: ${n.votes}票 (${n.result === "block" ? "待处决" : n.result === "tie" ? "平票" : "未通过"})`
    );
    parts.push(`<nominations>\n${nomLines.join("\n")}\n</nominations>`);
  }

  parts.push(`<critical_numbers>\n${tempoBrief(view)}\n</critical_numbers>`);

  const recentLog = view.log.slice(-15);
  if (recentLog.length) {
    parts.push(`<public_events>\n${recentLog.map((l) => `  - ${l.text}`).join("\n")}\n</public_events>`);
  }

  const claimSummary = buildPublicClaimSummary(view, chatHistory);
  if (claimSummary) parts.push(`<claim_summary>\n${claimSummary}\n</claim_summary>`);

  const claimAudit = buildClaimAudit(view, chatHistory);
  if (claimAudit) parts.push(`<claim_audit>\n${claimAudit}\n</claim_audit>`);

  const myRecent = (chatHistory || []).filter((c) => c.fromSeat === view.seat && c.to == null).slice(-3);
  if (myRecent.length) {
    const mineLines = myRecent.map((c) => `  - "${compactQuote(c.text, 70)}"`);
    parts.push(`<your_recent_speech>\n${mineLines.join("\n")}\n</your_recent_speech>`);
  }

  if (chatHistory && chatHistory.length) {
    const msgLines = chatHistory.slice(-40).map((c) => {
      const isSelf = c.fromSeat === view.seat;
      const who = `${c.fromSeat != null ? `${seatNo(c.fromSeat)}号 ` : ""}${c.fromName}${isSelf ? "(你自己)" : ""}`;
      const dm = c.to == null ? "" : isSelf ? `(你私聊${seatNo(c.to)}号)` : "(私聊你)";
      return `  ${who}${dm}: ${c.text}`;
    });
    parts.push(`<recent_messages>\n${msgLines.join("\n")}\n</recent_messages>`);
  }

  parts.push(`<identity_anchor>你是 ${seatNo(view.seat)}号「${view.name}」。上面 recent_messages 中只有标注"(你自己)"的才是你说过的话;其他人的发言、计划、身份声称都不是你的,绝不能用第一人称复述。</identity_anchor>`);

  return parts.join("\n\n");
}

export function nightActionPrompt(view, pendingAction) {
  const targets = pendingAction.targets;
  const alive = view.seats.filter((s) => s.alive);
  return [
    buildSituation(view, []),
    "",
    `现在是夜晚,轮到你行动:${pendingAction.prompt}。`,
    `从【存活玩家】中选择 ${targets} 名(使用座位表中的座位号,从1开始)。不要选择已死亡的玩家,那会浪费你的能力。`,
    `可选座位号: ${alive.filter((s) => !pendingAction.notSelf || s.seat !== view.seat).map((s) => seatNo(s.seat)).join(", ")}`,
    `只回复 JSON: {"targets": [座位号${targets === 2 ? ",座位号" : ""}], "reason": "简短理由"}`
  ].join("\n");
}

export function speechPrompt(view, chatHistory) {
  return PUBLIC_CHAT_TEMPLATE.replace("{{situation}}", buildSituation(view, chatHistory));
}

/**
 * 剧本白天主动能力的使用决策(如 TB 杀手开枪)。
 * 决策指引来自剧本 dayAction 配置的 aiGuide;缺省时用通用文案。
 */
export function dayActionPrompt(view, chatHistory, candidates, action) {
  const alive = view.seats.filter((s) => s.alive).length;
  const guide = action.aiGuide ||
    `你拥有白天主动能力「${action.label}」,尚未使用。请根据当前局势决定是否现在使用,以及对谁使用;不确定时可以暂不使用,保留能力。`;
  return [
    buildSituation(view, chatHistory),
    "",
    guide,
    `当前存活 ${alive} 人。`,
    `可选座位号(从1开始): ${candidates.map((c) => c + 1).join(", ")}`,
    '只回复 JSON: {"target": 座位号或null(暂不使用), "reason": "简短理由"}'
  ].join("\n");
}

export function nominationPrompt(view, chatHistory, candidates) {
  const alive = view.seats.filter((s) => s.alive).length;
  const hasBlock = view.onBlock && view.onBlock.seat != null;
  const factionLine = view.you.alignment === "evil"
    ? "你是邪恶阵营:可以提名善良玩家转移火力或完成关键处决,但注意提名本身会暴露你的立场倾向。"
    : [
        "你是善良阵营:白天的处决是善良唯一的主动武器。今天到现在" +
          (hasBlock ? `台上已有 ${view.seats[view.onBlock.seat].name}。若你认可这个处决目标,可以不提名;若你更怀疑别人,就提名他。` : "还没有人被送上处决台。"),
        hasBlock ? "" : `如果今天没有任何人被处决,入夜后恶魔照常杀人,存活将从 ${alive} 人继续减少——白白损失一天。除非你有强烈理由(比如需要保护关键身份),否则应当提名你当前最怀疑的人。`
      ].filter(Boolean).join("\n");
  return [
    buildSituation(view, chatHistory),
    "",
    "现在是提名阶段。你可以提名一名存活玩家送上处决台,或选择不提名。",
    factionLine,
    `可提名的座位号(从1开始,与座位表一致): ${candidates.map((c) => c + 1).join(", ")}`,
    '只回复 JSON: {"nominate": 座位号或null, "reason": "简短理由"}'
  ].join("\n");
}

export function votePrompt(view, chatHistory, voteCtx) {
  const nominee = view.seats[voteCtx.nominee];
  const nominator = view.seats[voteCtx.nominator];
  const votesSoFar = Object.values(voteCtx.votes).filter(Boolean).length;
  const alive = view.seats.filter((s) => s.alive).length;
  const execLine = Math.ceil(alive / 2);
  const endgameLine = alive <= 4
    ? `【生死投票】只剩 ${alive} 名存活玩家,这次处决很可能直接决定胜负:处决恶魔=善良获胜;处决好人=邪恶马上获胜。先在心里回答"${nominee.name} 是恶魔的概率有多高?场上还有谁更像恶魔?"再投票,不要跟风。`
    : "";
  const ghostLine = view.you.alive
    ? ""
    : `注意:你已死亡,整局只剩这一张遗书票,投了就没有了。${alive <= 4 ? "现在已是残局,正是用它的时候——但只投给你最确信是恶魔的人。" : "如果你不确定被提名者是恶魔,建议留着这张票到残局再用。"}`;
  return [
    buildSituation(view, chatHistory),
    "",
    `${nominator.name} 提名了 ${nominee.name},正在依次投票,目前 ${votesSoFar} 票赞成;处决线是 ${execLine} 票且需超过当日最高票。轮到你举手表决。`,
    endgameLine,
    ghostLine,
    '只回复 JSON: {"vote": true或false, "reason": "简短理由"}'
  ].filter(Boolean).join("\n");
}

export function whisperPrompt(view, chatHistory, fromName, text) {
  return [
    buildSituation(view, chatHistory),
    "",
    `${fromName} 私聊你说:"${text}"。请回复他(20-60字),注意私聊内容其他人看不到,可以交换情报或试探/欺骗。`,
    "红线:你声称的信息只能来自【你的私密信息】列表,善良阵营不得编造不存在的查验结果;邪恶阵营可以撒谎,但必须与你公开声称的身份和之前说过的话自洽。",
    '只回复 JSON: {"reply": "你的回复"}'
  ].join("\n");
}

/** 主动发起私聊的开场白 */
export function initiateWhisperPrompt(view, chatHistory, target) {
  const goal = view.you.alignment === "evil"
    ? (target.isTeammate
        ? "他是你的邪恶队友,私聊内容其他人看不到。协调战术:统一口径、商量今天把票推给谁、需要谁挡枪、伪装身份如何互相佐证。"
        : "他不是你的队友。可以套他的身份和信息、假装交换情报误导他、或拉拢他信任你。")
    : "你是善良阵营。可以交换/验证信息、试探对方身份、约定投票行动或建立信任小圈子。注意对方可能是邪恶玩家,别一次性交底。";
  return [
    buildSituation(view, chatHistory),
    "",
    `你决定主动私聊 ${target.name}。${goal}`,
    "写一条自然的开场私聊(20-60字),像真人玩家发消息,直接进入话题。",
    '只回复 JSON: {"whisper": "私聊内容"}'
  ].join("\n");
}

/** 白天结束后的推理档案更新(结构化长期记忆) */
export function memoPrompt(view, chatHistory, memo) {
  const prev = renderMemo(view, memo);
  const seatKeys = view.seats.map((s) => `"${seatNo(s.seat)}"`).join(", ");
  return [
    buildSituation(view, chatHistory),
    "",
    prev ? `【你此前的档案】\n${prev}` : "",
    "这个白天结束了。请更新你的推理档案:对每名玩家写一行(不超过40字),内容按需包含:声称的角色、报出的关键信息、与其他信息的矛盾、你判断的可信度(高/中/低/确认邪恶等)。",
    "要求:1) 合并旧档案,不要丢掉旧事实,除非有人明确改口或被证伪(那就记录改口本身,改口是重大嫌疑信号) 2) 记录必须忠实原话,二选一信息不能写成确认 3) self 记你自己公开声称/承诺过的内容,后续发言不能自相矛盾 4) plan 记你明天的计划和当前最怀疑的人及理由。",
    `只回复一个 JSON 对象,players 的键是座位号(${seatKeys}),值是那名玩家的一行档案。格式示例:`,
    '{"players": {"1": "声称图书管理员;首夜查到2/8号有隐士;可信度中", "2": "..."}, "self": "你自己的声称与承诺", "plan": "明天的计划与首要怀疑对象"}'
  ].filter(Boolean).join("\n");
}

/* ---------------- AI 说书人提示词 ---------------- */

const STORYTELLER_SYSTEM = (storytellerDocs["../../prompts/storyteller/system.md"] || "").trim();

export function buildStorytellerSystemPrompt() {
  return [STORYTELLER_SYSTEM, "", rulesBriefForScript()].join("\n");
}

/** 从说书人视角构建完整魔典与局势摘要 */
export function buildGrimoireSituation(stView) {
  const lines = [
    `【局势】第 ${stView.night} 夜 / 第 ${stView.day} 个白天(${stView.phase === "night" ? "夜晚" : "白天"}),存活 ${stView.seats.filter((s) => s.alive).length}/${stView.seats.length} 人。`,
    "【魔典(完整隐藏信息,严禁泄露)】",
    ...stView.seats.map((s) => {
      const marks = [];
      if (!s.alive) marks.push("死亡");
      if (s.poisonedBy != null) marks.push("中毒");
      if (s.protectedBy != null) marks.push("受保护");
      if (s.believedRole) marks.push(`伪装身份,自认为是${s.believedRole}`);
      if (s.redHerring) marks.push("红鲱鱼");
      return `${seatNo(s.seat)}号 ${s.name}: ${s.roleName}(${s.teamLabel},${s.alignmentLabel})${marks.length ? ` [${marks.join(",")}]` : ""}`;
    })
  ];
  if (stView.onBlock && stView.onBlock.seat != null) {
    lines.push(`【处决台】${stView.seats[stView.onBlock.seat].name} (${stView.onBlock.votes}票)`);
  }
  const recent = stView.log.slice(-12);
  if (recent.length) lines.push("【近期事件】", ...recent.map((l) => `- ${l.text}`));
  return lines.join("\n");
}

/** 裁量决策提示:从合法候选中选择 */
export function storytellerDecisionPrompt(stView, decision) {
  return [
    buildGrimoireSituation(stView),
    "",
    `【当前裁定】${decision.title}`,
    decision.detail || "",
    "候选项(全部合法,请依据平衡哲学选择):",
    ...decision.options.map((o, i) => `${i}. ${o.label}${i === decision.defaultIndex ? "(默认)" : ""}`),
    "",
    '只回复 JSON: {"choice": 候选序号, "reason": "简短平衡理由"}'
  ].join("\n");
}

/** 氛围旁白提示 */
export function storytellerNarrationPrompt(stView, event) {
  const desc = event.kind === "dawn"
    ? (event.deaths && event.deaths.length
        ? `天亮了,昨晚死亡的是:${event.deaths.join("、")}。`
        : "天亮了,昨晚是平安夜。")
    : event.text || "";
  return [
    `第 ${event.day} 个白天开始。${desc}`,
    "请以说书人口吻写 1-2 句中文氛围旁白(30-60字),渲染小镇的紧张气氛,可提及死者名字,但绝不能暗示任何隐藏身份、阵营或夜间行动细节。",
    '只回复 JSON: {"narration": "旁白文本"}'
  ].join("\n");
}
