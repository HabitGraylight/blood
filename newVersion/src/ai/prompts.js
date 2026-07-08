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
import { roleName } from "../scripts/trouble-brewing.js";

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

/** 对玩家展示的座位号统一为 1 号起(与游戏界面一致);引擎内部仍是 0 起 */
function seatNo(seat) {
  return seat + 1;
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

/** 构建系统提示:行为准则、身份、私密信息、角色策略、性格、长期记忆 */
export function buildSystemPrompt(view, persona, memo = null) {
  const you = view.you;
  const lines = [
    `${PLAYER_SYSTEM}`,
    "",
    RULES_BRIEF,
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

  if (memo && memo.summary) {
    lines.push("", `【你的长期记忆(截至第${memo.updatedDay}天,聊天记录之外的重要事实)】`, memo.summary);
  }

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
  const recentLog = view.log.slice(-15);
  lines.push("【公开事件】", ...recentLog.map((l) => `- ${l.text}`));
  if (chatHistory && chatHistory.length) {
    lines.push(
      "【最近发言】(按时间顺序,最后一条是最新发言;发言人前的编号即其座位号)",
      ...chatHistory.slice(-30).map(
        (c) => `${c.fromSeat != null ? `${c.fromSeat + 1}号 ` : ""}${c.fromName}${c.to != null ? "(私聊你)" : ""}: ${c.text}`
      )
    );
  }
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

export function nominationPrompt(view, chatHistory, candidates) {
  return [
    buildSituation(view, chatHistory),
    "",
    "现在是提名阶段。你可以提名一名存活玩家送上处决台,或选择不提名。",
    `可提名的座位号(从1开始,与座位表一致): ${candidates.map((c) => c + 1).join(", ")}`,
    '只回复 JSON: {"nominate": 座位号或null, "reason": "简短理由"}'
  ].join("\n");
}

export function votePrompt(view, chatHistory, voteCtx) {
  const nominee = view.seats[voteCtx.nominee];
  const nominator = view.seats[voteCtx.nominator];
  const votesSoFar = Object.values(voteCtx.votes).filter(Boolean).length;
  return [
    buildSituation(view, chatHistory),
    "",
    `${nominator.name} 提名了 ${nominee.name},正在依次投票,目前 ${votesSoFar} 票赞成。轮到你举手表决。`,
    view.you.alive ? "" : "注意:你已死亡,投赞成会用掉唯一的遗书票,慎重!",
    '只回复 JSON: {"vote": true或false, "reason": "简短理由"}'
  ].filter(Boolean).join("\n");
}

export function whisperPrompt(view, chatHistory, fromName, text) {
  return [
    buildSituation(view, chatHistory),
    "",
    `${fromName} 私聊你说:"${text}"。请回复他(20-60字),注意私聊内容其他人看不到,可以交换情报或试探/欺骗。`,
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

/** 白天结束后的长期记忆更新 */
export function memoPrompt(view, chatHistory, memo) {
  return [
    buildSituation(view, chatHistory),
    "",
    memo && memo.summary ? `【你此前的记忆】${memo.summary}` : "",
    "这个白天结束了。请把今天的重要情报浓缩进你的长期记忆:1) 谁声称了什么身份/信息 2) 你怀疑谁、为什么 3) 你接下来的计划。合并旧记忆,总长不超过150字。",
    '只回复 JSON: {"memo": "记忆内容"}'
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
