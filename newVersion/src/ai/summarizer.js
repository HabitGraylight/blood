/**
 * 每日摘要 Agent:白天结束时,将当天公开事件与发言压缩为紧凑摘要。
 *
 * 安全不变量(硬规则):
 * - 输入仅限公开事件日志(state.log 中 type!=="storyteller")与公开发言(chat 中 to==null)
 * - 严禁混入夜间行动、私密信息、邪恶阵营情报、玩家角色等非公开内容
 * - 输出只描述"每位玩家说了什么、干了什么",不推断角色或阵营
 *
 * 调用方: gameCore 在 endDay 成功后,phase==="night" 时异步触发(不阻塞游戏推进)
 * 失败策略: LLM 不可用时静默跳过,不影响游戏正常进行
 */
import { chatComplete, isLLMConfigured } from "./llm.js";

/**
 * 从公开事件日志中摘取与当前 day 相关的条目,构造摘要提示词,调用 LLM 产出紧凑摘要。
 *
 * @param {Array} publicEvents - state.log 按 day 过滤后的公开事件
 * @param {Array} publicChats - 当天公开发言(chat 中 to==null,按 day 字段过滤)
 * @param {string[]} seatNames - 座位号到玩家名的映射(如 ["张三","李四",...])
 * @param {number} dayIndex - 第几个白天(从1开始)
 * @returns {Promise<string|null>} 摘要文本或 null(失败时)
 */
export async function summarizeDay(publicEvents, publicChats, seatNames, dayIndex) {
  if (!isLLMConfigured()) return null;

  // 取当天最近20条公开事件
  const recentEvents = publicEvents.slice(-20);
  const eventLines = recentEvents.map((e) => `- ${e.text}`);

  // 取当天公开发言(最近40条)
  const recentChats = publicChats.slice(-40);
  const chatLines = recentChats.map((c) => {
    const name = c.fromName || (c.fromSeat != null ? seatNames[c.fromSeat] || `?` : "?");
    return `${name}: ${c.text}`;
  });

  // 不在摘要提示中出现任何"你是"/"你的角色"等词,仅用第三人称
  const prompt = [
    `第${dayIndex}天结束了。以下是这一天的公开事件和发言记录。`,
    "请用中文输出一段紧凑摘要(60-120字),用第三人称描述每位玩家说了什么、干了什么:",
    "",
    ...(eventLines.length ? ["【当天事件】", ...eventLines.slice(-15), ""] : []),
    ...(chatLines.length ? ["【当天发言】", ...chatLines.slice(-30), ""] : []),
    "",
    "要求:",
    "1. 使用玩家名字,不带座位号",
    "2. 只描述公开可见的行为:谁提名了谁、谁投票赞成/反对、谁被处决/死亡、谁公开说了什么关键信息",
    "3. 绝不推断角色、阵营或隐藏信息",
    "4. 输出纯文本,不含JSON、markdown或任何格式标记"
  ].join("\n");

  try {
    const text = await chatComplete(
      [{ role: "user", content: prompt }],
      { maxTokens: 250, temperature: 0.2, systemBlocks: [] }
    );
    if (text && text.trim()) {
      return text.trim().slice(0, 300);
    }
    return null;
  } catch (err) {
    console.warn(`[Summarizer] 第${dayIndex}天摘要失败:`, err.message);
    return null;
  }
}
