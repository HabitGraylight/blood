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
import { roleName } from "../core/data/roles.js";

// Vite 在构建时把 markdown 内容内联进来
const roleDocs = import.meta.glob("../../prompts/roles/*.md", {
  eager: true, query: "?raw", import: "default"
});
const playerDocs = import.meta.glob("../../prompts/ai-player/*.md", {
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

function seatLine(s) {
  const tags = [];
  if (!s.alive) tags.push(s.ghostVote ? "死亡·有遗书票" : "死亡·无投票权");
  return `${s.seat}号 ${s.name}${tags.length ? ` (${tags.join(",")})` : ""}`;
}

/** 构建系统提示:行为准则、身份、私密信息、角色策略、性格 */
export function buildSystemPrompt(view, persona) {
  const you = view.you;
  const lines = [
    `${PLAYER_SYSTEM}`,
    "",
    RULES_BRIEF,
    "",
    `【你的座位】你是 ${view.seat}号玩家「${view.name}」`,
    `【你的身份】${you.roleName}(${you.teamLabel},${you.alignmentLabel}阵营)`,
    `【你的能力】${you.ability}`,
    you.alive ? "" : "【注意】你已死亡,仍可发言" + (you.ghostVote ? ",还有一次遗书票。" : ",且无法再投票。"),
    "",
    "【角色策略】",
    roleDoc(you.role)
  ];

  if (you.evilInfo) {
    const demon = view.seats[you.evilInfo.demonSeat];
    const minions = you.evilInfo.minionSeats.map((s) => `${s}号 ${view.seats[s].name}`);
    lines.push(
      "",
      `【邪恶阵营情报】恶魔是 ${you.evilInfo.demonSeat}号 ${demon.name}` +
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

  lines.push("", `【性格设定】${persona || "冷静理性,善于观察"}`);
  return lines.filter((l) => l !== null && l !== undefined && l !== "").join("\n");
}

/** 构建当前局面描述 */
export function buildSituation(view, chatHistory) {
  const lines = [
    `【当前局面】第 ${view.day} 个白天,存活 ${view.seats.filter((s) => s.alive).length} 人。`,
    "【座位表】",
    ...view.seats.map(seatLine),
    ""
  ];
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
      "【最近发言】",
      ...chatHistory.slice(-30).map((c) => `${c.fromName}${c.to != null ? "(私聊你)" : ""}: ${c.text}`)
    );
  }
  return lines.join("\n");
}

export function nightActionPrompt(view, pendingAction) {
  const targets = pendingAction.targets;
  return [
    buildSituation(view, []),
    "",
    `现在是夜晚,轮到你行动:${pendingAction.prompt}。`,
    `从座位表中选择 ${targets} 名玩家(用座位号)。`,
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
    `可提名的座位号: ${candidates.join(", ")}`,
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
