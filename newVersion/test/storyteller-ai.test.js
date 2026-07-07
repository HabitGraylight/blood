import { describe, it, expect } from "vitest";
import { GameEngine } from "../src/core/engine.js";
import { createRng } from "../src/core/rng.js";
import { AIStoryteller } from "../src/ai/storytellerController.js";
import { buildStorytellerSystemPrompt, storytellerDecisionPrompt } from "../src/ai/prompts.js";
import { storytellerView } from "../src/core/view.js";

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `玩家${i}`, isHuman: false
  }));
}

describe("AI 说书人", () => {
  it("storytellerMode='ai' 与 human 一样触发裁量挂起", () => {
    const engine = GameEngine.create(makePlayers(7), {
      seed: 7,
      fixedRoles: ["washerwoman", "empath", "fortuneteller", "monk", "soldier", "poisoner", "imp"],
      storytellerMode: "ai"
    });
    expect(engine.state.pendingStorytellerDecision).toBeTruthy();
    expect(engine.state.pendingStorytellerDecision.type).toBe("setup-redherring");
  });

  it("LLM 不可用时 decide 回退到默认项", async () => {
    const st = new AIStoryteller(createRng(1));
    const decision = {
      id: 1,
      title: "测试裁定",
      detail: "",
      options: [{ label: "A" }, { label: "B" }],
      defaultIndex: 1
    };
    const engine = GameEngine.create(makePlayers(5), {
      seed: 5,
      fixedRoles: ["chef", "soldier", "mayor", "baron", "imp"]
    });
    const { choice } = await st.decide(storytellerView(engine.state), decision);
    expect(choice).toBe(1);
  });

  it("LLM 不可用时天亮旁白使用预置文案", async () => {
    const st = new AIStoryteller(createRng(2));
    const engine = GameEngine.create(makePlayers(5), {
      seed: 5,
      fixedRoles: ["chef", "soldier", "mayor", "baron", "imp"]
    });
    const withDeaths = await st.narrate(storytellerView(engine.state), {
      kind: "dawn", day: 2, deaths: ["玩家1"]
    });
    expect(withDeaths).toContain("玩家1");
    const peaceful = await st.narrate(storytellerView(engine.state), {
      kind: "dawn", day: 2, deaths: []
    });
    expect(typeof peaceful).toBe("string");
    expect(peaceful.length).toBeGreaterThan(5);
  });

  it("说书人提示词包含平衡哲学与完整魔典", () => {
    const sys = buildStorytellerSystemPrompt();
    expect(sys).toContain("平衡");
    const engine = GameEngine.create(makePlayers(7), {
      seed: 7,
      fixedRoles: ["washerwoman", "empath", "fortuneteller", "monk", "soldier", "poisoner", "imp"],
      storytellerMode: "ai"
    });
    const d = engine.state.pendingStorytellerDecision;
    const prompt = storytellerDecisionPrompt(storytellerView(engine.state), d);
    expect(prompt).toContain("魔典");
    expect(prompt).toContain(d.title);
    expect(prompt).toContain("0. ");
    expect(prompt).toContain('"choice"');
    // 魔典中包含隐藏身份(小恶魔)
    expect(prompt).toContain("小恶魔");
  });
});
