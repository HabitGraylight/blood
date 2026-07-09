/**
 * AI 玩家提示词构建。
 * 全部基于 playerView 投影 —— AI 只能"看到"同座位真人玩家能看到的信息,
 * 从机制上杜绝 AI 作弊。
 *
 * 行为准则与角色策略来自 prompts/ 目录的 markdown 文件,可直接编辑调优:
 * - prompts/ai-player/system.md   通用玩家行为准则
 * - prompts/ai-player/public-chat.md  公开发言任务模板
 * - prompts/roles/{roleId}.md     角色专属策略;缺失时用 default.md
 */
import { roleName, TEAM_LABELS } from "../scripts/trouble-brewing.js";
import { getScript } from "../scripts/registry.js";

// Vite 在构建时把 markdown 内容内联进来
const roleDocs = import.meta.glob("../../prompts/roles/*.md", {
  eager: true, query: "?raw", import: "default"
});
const playerDocs = import.meta.glob("../../prompts/ai-player/*.md", {
  eager: true, query: "?raw", import: "default"
});
const storytellerDocs = import.meta.glob("../../prompts/storyteller/*.md", {
  eager: true, query: "?raw", import: "default"
});

function roleDoc(roleId) {
  return (
    roleDocs[`../../prompts/roles/${roleId}.md`] ||
    roleDocs["../../prompts/roles/default.md"] ||
    ""
  ).trim();
}

const PLAYER_SYSTEM = (playerDocs["../../prompts/ai-player/system.md"] || "").trim();
const PUBLIC_CHAT_TEMPLATE = (playerDocs["../../prompts/ai-player/public-chat.md"] || "").trim();

const RULES_BRIEF = `《血染钟楼·暗流涌动》规则要点:
- 村民和外来者属于善良阵营;爪牙和恶魔属于邪恶阵营。
- 恶魔(小恶魔)每晚杀一人(首夜除外)。恶魔死亡则善良获胜;场上只剩两名存活玩家则邪恶获胜。
- 白天所有人讨论,可以提名;得票达到存活人数一半且高于当日最高票者,黄昏时被处决。
- 死亡玩家仍可说话,保留最后一次投票机会(遗书票)。
- 信息可能是假的:中毒、酒鬼、间谍误导、隐士误判、占卜师的红鲱鱼都会制造假信息。`;

const REASONING_BRIEF = `【推理工作流】发言前在心里完成,不要把步骤逐条输出:
1. 事实抽取:先列出每名玩家的公开身份声明、能力信息、投票/提名、否认或改口,只使用上下文中出现过的内容。
2. 声称审计:把每个人声称的角色对照【剧本角色表】——角色名不在表里、或把能力说错(比如说"厨师能保护人"),这是重大邪恶信号,应当公开质疑;再对照【人数配置】数一数各类声称数量,外来者声称超编几乎说明男爵在场。
3. 约束合并:把“二选一/至少一人/没有命中/确认某角色”等信息当作逻辑约束合并;如果一个候选被另一条可信信息支持,压力会转移到同组另一端。
4. 假设分支:分别考虑“这条信息真”“这条信息假或受误导”“说话者在撒谎”三种分支,不要只挑对自己方便的一支。
5. 死亡线索:恶魔倾向夜杀信息型角色。某人公开关键信息后当晚被杀,他的信息可信度上升;自称信息位却一直活到残局、从不被刀的人反而更可疑。
6. 反证检查:结论出手前,检查它是否与已公开身份、已死亡名单、自己此前发言或最新回应冲突。
7. 置信表达:证据链完整时可以明确推动;只有部分线索时用怀疑、追问或条件句;邪恶玩家可以撒谎,但谎言也要自洽。`;

/** 剧本角色速查表:AI 识破假角色/假能力声称的依据 */
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

/** 其它桌游/剧本里常见、但本剧本不存在的角色叫法(AI 和玩家都容易叫错) */
const FOREIGN_ROLE_WORDS = ["猎手", "大厨", "预言家", "女巫", "守卫", "骑士", "狼人", "先知", "猎人", "白痴", "祖母", "舞蛇人"];

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
    for (const w of FOREIGN_ROLE_WORDS) {
      if (text.includes(w)) {
        if (!foreign.has(c.fromSeat)) foreign.set(c.fromSeat, new Set());
        foreign.get(c.fromSeat).add(w);
      }
    }
  }
  if (!claims.size && !foreign.size) return "";

  const byName = new Map(Object.values(script.roles).map((r) => [r.name, r]));
  const lines = ["【身份声称对照】(由发言自动提取;能力以剧本角色表为准,核对每个人的说法是否与真实能力一致)"];
  for (const [seat, set] of claims) {
    const s = view.seats[seat];
    for (const rn of set) {
      const r = byName.get(rn);
      lines.push(`- ${seatNo(seat)}号 ${s ? s.name : "?"} 声称「${rn}」→ 真实能力: ${r.ability}${r.clarify ? ` (${r.clarify})` : ""}`);
    }
  }
  for (const [seat, set] of foreign) {
    const s = view.seats[seat];
    lines.push(`- ⚠ ${seatNo(seat)}号 ${s ? s.name : "?"} 的发言里出现了本剧本不存在的角色名: ${[...set].join("、")} —— 本剧本没有这些角色;如果他在用这种名字声称身份或描述能力,基本可以断定是编造。你自己也绝不要使用这些叫法。`);
  }
  return lines.join("\n");
}

/** 人数配置与外来者核算 */
function compositionBrief(view) {
  const script = getScript(view.scriptId);
  const n = view.seats.length;
  const t = script.setupTable && script.setupTable[n];
  if (!t) return "";
  return [
    `【人数配置】${n}人局标准配置: 村民${t.townsfolk}、外来者${t.outsider}、爪牙${t.minion}、恶魔${t.demon}。`,
    `若男爵在场则改为: 村民${t.townsfolk - 2}、外来者${t.outsider + 2}。推理时数一数场上声称的外来者(酒鬼被处决前不会自称酒鬼,要靠排除):声称外来者的人数超过标准配置,几乎说明男爵在场;反之若男爵已被证实,场上就应该有${t.outsider + 2}个外来者位,自称村民的人里必然混着外来者或说谎者。`
  ].join("\n");
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
    const lines = [`【你的推理档案(你自己维护的工作记忆,截至第${memo.updatedDay}天)】`];
    for (const s of view.seats) {
      const note = memo.players[String(seatNo(s.seat))] || memo.players[seatNo(s.seat)];
      if (note) lines.push(`- ${seatNo(s.seat)}号 ${s.name}${s.alive ? "" : "(已死)"}: ${String(note).slice(0, 80)}`);
    }
    if (memo.self) lines.push(`- 你自己的声称/承诺: ${String(memo.self).slice(0, 80)}`);
    if (memo.plan) lines.push(`- 你的计划与首要怀疑: ${String(memo.plan).slice(0, 100)}`);
    return lines.length > 1 ? lines.join("\n") : "";
  }
  if (memo.summary) {
    return `【你的长期记忆(截至第${memo.updatedDay}天,聊天记录之外的重要事实)】\n${memo.summary}`;
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
 */
function tempoBrief(view) {
  const alive = view.seats.filter((s) => s.alive).length;
  const execLine = Math.ceil(alive / 2);
  const lines = [`【关键数字】存活 ${alive} 人;处决需要至少 ${execLine} 票且为当日最高票。场上只剩 2 名存活玩家时邪恶立即获胜。`];
  if (alive === 3) {
    lines.push(
      "【终局警告】只剩 3 人,恶魔几乎必在其中(除非它已死)。今天不处决任何人、或处决了好人 → 入夜后恶魔杀 1 人只剩 2 人,邪恶立即获胜。善良阵营:今天必须处决恶魔,这是唯一也是最后的机会;逐一核对存活 3 人的身份声称——谁的角色/能力说辞对不上剧本、谁的信息链无人佐证、谁一直没被恶魔刀,谁就最可能是恶魔。不要因为某人发言混乱就投他,酒鬼和隐士本来就会混乱;要投的是逻辑上最可能是恶魔的人。若有存活玩家声称杀手且未开枪,让他当场对最可疑者开枪是免费的验证;声称杀手却反复拒绝开枪的人非常可疑。"
    );
  } else if (alive === 4) {
    lines.push(
      "【残局警告】只剩 4 人,恶魔就在其中。今天处决错人,明晚恶魔再杀 1 人只剩 2 人,邪恶获胜——今天基本是善良最后一次纠错机会,必须把票投给最可能是恶魔的人,而不是最吵的人。若有存活玩家声称杀手且未开枪,推动他当场开枪验证。"
    );
  } else if (alive === 5) {
    lines.push("【节奏提醒】只剩 5 人。若今天不处决,入夜再死 1 人就进入 4 人残局,善良容错只剩一次。");
  }
  if (view.phase === "day" && alive > 5) {
    lines.push("【节奏提醒】白天的处决是善良阵营唯一的主动进攻手段;一天不处决,等于白送邪恶一个夜晚。处决可疑者哪怕错了,也能换来死亡信息(如送葬者查验、声称对错的验证)。");
  }
  return lines.join("\n");
}

const CLAIM_PATTERNS = [
  { label: "身份声明", re: /我是|我跳|我报|身份|占卜师|厨师|共情者|调查员|图书管理员|洗衣妇|僧侣|隐士|管家|圣女|杀手|猎手|士兵|镇长|送葬者|守鸦人|圣徒|酒鬼|镇民/ },
  { label: "能力信息", re: /查了|查的|查到|得知|信息|红光|没红光|有恶魔|没有恶魔|有爪牙|好人|坏人|邪恶|善良|两人中|其中/ },
  { label: "指控/投票", re: /说谎|撒谎|狼|恶魔|爪牙|可疑|假跳|冒充|混子|投|票|提名|处决/ },
  { label: "否认/改口", re: /没说过|我没说|不是我说|听岔|记错|忘了|改口|撤回|重新说/ }
];

function compactQuote(text, max = 90) {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine;
}

function claimLabels(text) {
  return CLAIM_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
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
    const labels = claimLabels(c.text || "");
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
    "【公开声明摘要】(来自最近约120条公开发言;这是原话摘要,不要改写成相反意思)",
    ...[...byPlayer.values()].map((entry) => `- ${entry.name}: ${entry.lines.join("; ")}`)
  ];
  if (hasPairInfo) {
    lines.push("【推理提醒】二选一或至少一人命中的信息,不能转述成两人都是、两人都说谎或两人都邪恶。");
  }
  if (selfLines.length) {
    lines.push("【你自己此前公开说过】", ...selfLines.slice(-8));
  }
  return lines.join("\n");
}

/** 构建系统提示:行为准则、身份、私密信息、角色策略、性格、长期记忆 */
export function buildSystemPrompt(view, persona, memo = null) {
  const you = view.you;
  const lines = [
    `${PLAYER_SYSTEM}`,
    "",
    RULES_BRIEF,
    "",
    scriptRolesBrief(view),
    "",
    compositionBrief(view),
    "",
    REASONING_BRIEF,
    "",
    `【你的座位】你是 ${seatNo(view.seat)}号玩家「${view.name}」(座位号从1开始,与座位表一致)`,
    `【你的身份】${you.roleName}(${you.teamLabel},${you.alignmentLabel}阵营)`,
    `【你的能力】${you.ability}`,
    you.alive ? "" : "【注意】你已死亡,仍可发言" + (you.ghostVote ? ",还有一次遗书票。" : ",且无法再投票。"),
    "",
    "【角色策略】",
    roleDoc(you.role),
    "",
    `【阶段建议】${stageAdvice(view)}`
  ];

  if (you.evilInfo) {
    const demon = view.seats[you.evilInfo.demonSeat];
    const minions = you.evilInfo.minionSeats.map((s) => `${seatNo(s)}号 ${view.seats[s].name}`);
    lines.push(
      "",
      `【邪恶阵营情报】恶魔是 ${seatNo(you.evilInfo.demonSeat)}号 ${demon.name}` +
        (minions.length ? `;爪牙: ${minions.join("、")}` : "")
    );
    if (you.evilInfo.bluffs && you.evilInfo.bluffs.length) {
      lines.push(`【可用伪装】这些角色不在场上,可谎称: ${you.evilInfo.bluffs.map(roleName).join("、")}`);
    }
  }

  if (you.privateLog.length) {
    lines.push(
      "",
      "【你的私密信息(只有你知道)】",
      ...you.privateLog.map((l) => `- [第${l.night}夜] ${l.text}`)
    );
  }

  const memoBlock = renderMemo(view, memo);
  if (memoBlock) lines.push("", memoBlock);

  lines.push("", `【性格设定】${persona || "冷静理性,善于观察"}`);
  return lines.filter((l) => l !== null && l !== undefined && l !== "").join("\n");
}

/** 构建当前局面描述 */
export function buildSituation(view, chatHistory) {
  const aliveSeats = view.seats.filter((s) => s.alive);
  const deadSeats = view.seats.filter((s) => !s.alive);
  const lines = [
    `【当前局面】第 ${view.day} 个白天,存活 ${aliveSeats.length} 人。`,
    "【座位表】",
    ...view.seats.map(seatLine),
    `【存活玩家】${aliveSeats.map((s) => `${seatNo(s.seat)}号 ${s.name}`).join("、")}`,
    deadSeats.length
      ? `【已死亡】${deadSeats.map((s) => `${seatNo(s.seat)}号 ${s.name}`).join("、")} —— 死者不能被提名、处决或作为投票对象;夜间能力也不应选择死者。谈论计划前先核对这份名单。`
      : "",
    ""
  ].filter((l) => l !== "");
  lines.push("");
  if (view.onBlock && view.onBlock.seat != null) {
    lines.push(`当前处决台上: ${view.seats[view.onBlock.seat].name} (${view.onBlock.votes}票)`);
  }
  if (view.nominations.length) {
    lines.push(
      "【今日提名记录】",
      ...view.nominations.map(
        (n) => `${view.seats[n.nominator].name} 提名 ${view.seats[n.nominee].name}: ${n.votes}票 (${n.result === "block" ? "待处决" : n.result === "tie" ? "平票" : "未通过"})`
      )
    );
  }
  lines.push(tempoBrief(view));
  const recentLog = view.log.slice(-15);
  lines.push("【公开事件】", ...recentLog.map((l) => `- ${l.text}`));
  const claimSummary = buildPublicClaimSummary(view, chatHistory);
  if (claimSummary) lines.push(claimSummary);
  const claimAudit = buildClaimAudit(view, chatHistory);
  if (claimAudit) lines.push(claimAudit);
  const myRecent = (chatHistory || []).filter((c) => c.fromSeat === view.seat && c.to == null).slice(-3);
  if (myRecent.length) {
    lines.push(
      "【你最近的公开发言】(逐字记录;不要原样重复这些话,已提过的问题/要求别人回应过就不要再问)",
      ...myRecent.map((c) => `- "${compactQuote(c.text, 70)}"`)
    );
  }
  if (chatHistory && chatHistory.length) {
    lines.push(
      "【最近发言】(按时间顺序,最后一条是最新发言;发言人前的编号即其座位号;标注“(你自己)”的是你说过的话)",
      ...chatHistory.slice(-40).map((c) => {
        const isSelf = c.fromSeat === view.seat;
        const who = `${c.fromSeat != null ? `${seatNo(c.fromSeat)}号 ` : ""}${c.fromName}${isSelf ? "(你自己)" : ""}`;
        const dm = c.to == null ? "" : isSelf ? `(你私聊${seatNo(c.to)}号)` : "(私聊你)";
        return `${who}${dm}: ${c.text}`;
      })
    );
  }
  lines.push(
    "",
    `【身份锚点】你是 ${seatNo(view.seat)}号「${view.name}」。上面【最近发言】中只有标注“(你自己)”的才是你说过的话;其他人的发言、计划、身份声称都不是你的,绝不能用第一人称复述。发言时把自己的名字当第三者谈论是致命错误。`
  );
  return lines.join("\n");
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

/** 杀手(或自认为是杀手的人)决定是否公开开枪 */
export function slayerShotPrompt(view, chatHistory, candidates) {
  const alive = view.seats.filter((s) => s.alive).length;
  return [
    buildSituation(view, chatHistory),
    "",
    "你的角色是杀手,整局限一次的公开开枪能力还没有用。现在决定要不要开枪:公开指认一名存活玩家,如果他是恶魔,他当场死亡、善良几乎立刻获胜;如果不是,什么都不会发生,而你的能力就此耗尽。",
    "时机判断:",
    "- 有较强证据指向某人是恶魔时,开枪是善良最干脆的斩杀手段。",
    `- 残局(当前存活 ${alive} 人)再捏着不用,能力会跟着你一起死掉;存活≤4时,对最可能是恶魔的人开枪几乎总是正确的——即使打空,也排除了一个嫌疑。`,
    "- 多人强烈要求你开枪验证时,一直拒绝会让你自己成为头号嫌疑。",
    "- 前中期证据不足时可以暂不开枪,继续收集信息。",
    `可选座位号(从1开始): ${candidates.map((c) => c + 1).join(", ")}`,
    '只回复 JSON: {"target": 座位号或null(暂不开枪), "reason": "简短理由"}'
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
    ? `【生死投票】只剩 ${alive} 名存活玩家,这次处决很可能直接决定胜负:处决恶魔=善良获胜;处决好人=邪恶马上获胜。先在心里回答“${nominee.name} 是恶魔的概率有多高?场上还有谁更像恶魔?”再投票,不要跟风。`
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
  return [STORYTELLER_SYSTEM, "", RULES_BRIEF].join("\n");
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
      if (s.protectedBy != null) marks.push("被僧侣保护");
      if (s.believedRole) marks.push(`酒鬼,自认为是${s.believedRole}`);
      if (s.redHerring) marks.push("红鲱鱼");
      return `${s.seat + 1}号 ${s.name}: ${s.roleName}(${s.teamLabel},${s.alignmentLabel})${marks.length ? ` [${marks.join(",")}]` : ""}`;
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
