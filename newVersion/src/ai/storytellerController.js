/**
 * AI 说书人。
 * 依据完整魔典(storytellerView)对引擎挂起的裁量决策作出选择,
 * 并在关键节点生成氛围旁白。
 * 与 AIPlayer 相同的健壮性哲学:LLM 优先,失败/未配置时回退默认项,游戏永不卡死。
 */
import { chatComplete, extractJSON, isLLMConfigured } from "./llm.js";
import {
  buildStorytellerSystemPrompt,
  storytellerDecisionPrompt,
  storytellerNarrationPrompt
} from "./prompts.js";

export class AIStoryteller {
  constructor(rng) {
    this.rng = rng;
  }

  async _ask(userPrompt, options = {}) {
    if (!isLLMConfigured()) return null;
    try {
      const text = await chatComplete(
        [
          { role: "system", content: buildStorytellerSystemPrompt() },
          { role: "user", content: userPrompt }
        ],
        { maxTokens: 300, temperature: 0.4, timeoutMs: 30000, ...options }
      );
      return extractJSON(text);
    } catch (err) {
      console.warn("AI 说书人 LLM 调用失败,使用默认裁定:", err.message);
      return null;
    }
  }

  /**
   * 对一个待裁定事项作出选择。
   * @returns {Promise<{choice: number, reason: string|null}>} 候选序号(失败时为默认项)
   */
  async decide(stView, decision) {
    const result = await this._ask(storytellerDecisionPrompt(stView, decision));
    if (result && Number.isInteger(result.choice) && decision.options[result.choice]) {
      return { choice: result.choice, reason: typeof result.reason === "string" ? result.reason.slice(0, 120) : null };
    }
    return { choice: decision.defaultIndex, reason: null };
  }

  /**
   * 关键节点的氛围旁白。
   * dawn/execution 走 LLM(失败回退模板);其余节点(开放提名、上处决台等)
   * 直接用模板,不消耗调用额度。
   */
  async narrate(stView, event) {
    if (event.kind === "dawn" || event.kind === "execution") {
      const result = await this._ask(storytellerNarrationPrompt(stView, event), { maxTokens: 200, temperature: 0.8 });
      if (result && typeof result.narration === "string" && result.narration.trim()) {
        return result.narration.trim().slice(0, 160);
      }
    }
    return this._templateNarration(event);
  }

  _templateNarration(event) {
    switch (event.kind) {
      case "dawn": {
        if (event.deaths && event.deaths.length) {
          const names = event.deaths.join("、");
          return this.rng.pick([
            `晨钟敲响,${names}再也没有醒来。小镇的空气里弥漫着血腥味。`,
            `黎明时分,人们在门前发现了${names}冰冷的身体。凶手仍在你们中间。`,
            `${names}的房间一片死寂。钟楼的阴影下,恐惧在蔓延。`
          ]);
        }
        return this.rng.pick([
          "晨光照进小镇,所有人都平安醒来——但这份平静让人更加不安。",
          "昨夜无人死去。是谁在暗中蛰伏,等待更好的时机?",
          "平安夜。可钟楼上的乌鸦仍在盘旋,注视着每一个人。"
        ]);
      }
      case "execution": {
        const name = event.name || "他";
        return this.rng.pick([
          `绳索收紧,${name}被吊上了钟楼。愿真相与他同在——无论他是谁。`,
          `小镇用最古老的方式处决了${name}。人群散去时,没有人敢对视。`,
          `${name}的身影在夕阳下晃动。正义,或是又一次错杀?夜幕即将揭晓。`
        ]);
      }
      case "nominations-open":
        return this.rng.pick([
          "说书人环视全场:「提名开始。今天,谁要把谁送上处决台?」",
          "钟声响起,提名台已经架好。犹豫的人,往往活不到最后。",
          "「到了做决定的时候了。」说书人翻开册子,等待第一个提名。"
        ]);
      case "block": {
        const name = event.name || "有人";
        return this.rng.pick([
          `${name} 站上了处决台。黄昏之前,还有人想改变这个结局吗?`,
          `处决台的阴影落在 ${name} 身上。要救他,就再提名一个得票更高的。`
        ]);
      }
      default:
        return null;
    }
  }
}
