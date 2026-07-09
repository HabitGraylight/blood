import { describe, it, expect } from "vitest";
import { buildPublicClaimSummary, buildSituation, buildSystemPrompt } from "../src/ai/prompts.js";
import { AIDriver } from "../src/session/aiDriver.js";
import { GameEngine } from "../src/core/engine.js";
import { SCRIPT_REGISTRY, TEAM } from "../src/scripts/registry.js";

function viewStub(seat = 0) {
  return {
    seat,
    day: 1,
    seats: [
      { seat: 0, name: "我", alive: true },
      { seat: 1, name: "老鬼", alive: true },
      { seat: 2, name: "大鹏", alive: true },
      { seat: 3, name: "老赵", alive: true },
      { seat: 4, name: "老周", alive: true }
    ],
    log: [],
    nominations: []
  };
}

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: ["我", "老鬼", "大鹏", "老赵", "老周"][i] || `玩家${i}`,
    isHuman: i === 0
  }));
}

function autoNight(engine) {
  let guard = 0;
  while (engine.state.phase === "night" && guard++ < 50) {
    const pa = engine.state.pendingAction;
    if (!pa) break;
    const pool = engine.state.players.filter((p) => p.alive && (!pa.notSelf || p.seat !== pa.seat));
    engine.dispatch({ type: "nightAction", seat: pa.seat, targets: pool.slice(0, pa.targets).map((p) => p.seat) });
  }
}

describe("AI 玩家推理提示", () => {
  it("使用通用推理工作流,而不是局部数字特例", () => {
    const view = {
      ...viewStub(),
      name: "我",
      you: {
        role: "chef",
        roleName: "厨师",
        teamLabel: "村民",
        alignmentLabel: "善良",
        ability: "首夜得知相邻邪恶玩家对数。",
        alive: true,
        privateLog: []
      }
    };

    const prompt = buildSystemPrompt(view, "冷静理性");
    expect(prompt).toContain("【推理工作流】");
    expect(prompt).toContain("事实抽取");
    expect(prompt).toContain("约束合并");
    expect(prompt).toContain("假设分支");
    expect(prompt).toContain("不要把步骤逐条输出");
  });
});

describe("AI 玩家公开声明摘要", () => {
  it("保留较早的查验声明,即使后来有人否认说过", () => {
    const chat = [
      { fromSeat: 1, fromName: "老鬼", to: null, text: "我查的也是2号和3号,跟老周结果一样。" },
      ...Array.from({ length: 35 }, (_, i) => ({ fromSeat: 2, fromName: "大鹏", to: null, text: `闲聊第${i}句` })),
      { fromSeat: 1, fromName: "老鬼", to: null, text: "我从头到尾就没说过我是占卜师啊,你是不是听岔了?" }
    ];

    const summary = buildPublicClaimSummary(viewStub(), chat);
    expect(summary).toContain("老鬼");
    expect(summary).toContain("我查的也是2号和3号");
    expect(summary).toContain("我从头到尾就没说过");
  });

  it("提示二选一信息不能被说成两人都坏", () => {
    const chat = [
      { fromSeat: 0, fromName: "我", to: null, text: "我昨晚查了两个人,其中有爪牙。" }
    ];

    const situation = buildSituation(viewStub(), chat);
    expect(situation).toContain("至少一人命中");
    expect(situation).toContain("不能转述成两人都是");
    expect(situation).not.toContain("两人都说谎。");
  });

  it("超过最近30条后,早期身份声明仍进入结构化摘要", () => {
    const chat = [
      { fromSeat: 4, fromName: "老周", to: null, text: "我是占卜师,昨晚查了老鬼和大鹏没红光。" },
      ...Array.from({ length: 45 }, (_, i) => ({ fromSeat: 3, fromName: "老赵", to: null, text: `普通发言${i}` }))
    ];

    const situation = buildSituation(viewStub(), chat);
    expect(situation).toContain("【公开声明摘要】");
    expect(situation).toContain("我是占卜师");
    expect(situation).toContain("查了老鬼和大鹏没红光");
  });
});

describe("AI 白天节奏计划", () => {
  it("有真人存活时降低反应预算,且提名前总结不进入讨论队列", () => {
    const engine = GameEngine.create(makePlayers(5), {
      seed: 5,
      fixedRoles: ["chef", "soldier", "scarletwoman", "baron", "imp"]
    });
    autoNight(engine);

    const rng = {
      shuffle(items) { return [...items]; },
      chance() { return true; },
      int() { return 0; },
      pick(items) { return items[0]; }
    };
    const aiPlayers = new Map(
      engine.state.players
        .filter((p) => !p.isHuman)
        .map((p) => [p.seat, { traits: { aggr: 0.5, talk: 1 } }])
    );
    const driver = new AIDriver({
      engine,
      aiPlayers,
      rng,
      getChatFor: () => [],
      pushChat: () => 1,
      onChange: () => {}
    });

    driver._buildDayPlan();

    expect(driver.dayPlan.reactBudget).toBe(2);
    expect(driver.dayPlan.queue.some((item) => item.round === "提名前总结")).toBe(false);
    expect(driver.dayPlan.nominationQueue.length).toBeGreaterThan(0);
    expect(driver.dayPlan.queue.filter((item) => item.round === "信息交换")).toHaveLength(3);
  });

  it("真人触发的反应不会继续消耗 AI 连锁追问预算", () => {
    const engine = GameEngine.create(makePlayers(5), {
      seed: 5,
      fixedRoles: ["chef", "soldier", "scarletwoman", "baron", "imp"]
    });
    autoNight(engine);
    const driver = new AIDriver({
      engine,
      aiPlayers: new Map([[1, { traits: { talk: 1 } }], [2, { traits: { talk: 1 } }]]),
      rng: { shuffle: (x) => [...x], chance: () => true, int: () => 0, pick: (x) => x[0] },
      getChatFor: () => [],
      pushChat: () => 1,
      onChange: () => {}
    });
    driver.dayPlan = { reactBudget: 2 };

    driver._maybeAIReact(0, "老鬼你怎么看?", 1, 1, { fromHuman: true });

    expect(driver.dayPlan.reactBudget).toBe(2);
    expect(driver.scheduled.size).toBe(0);
  });
});
describe("AI prompt script isolation", () => {
  it("uses the current script instead of Trouble Brewing prompt constants", () => {
    SCRIPT_REGISTRY["mock-script"] = {
      id: "mock-script",
      name: "Mock Script",
      rulesBrief: "MOCK RULES ONLY",
      foreignRoleWords: ["ForeignOnly"],
      setupTable: { 5: { townsfolk: 3, outsider: 0, minion: 1, demon: 1 } },
      roles: {
        alpha: { id: "alpha", name: "Alpha", team: TEAM.TOWNSFOLK, ability: "Alpha ability" },
        beta: { id: "beta", name: "Beta", team: TEAM.OUTSIDER, ability: "Beta ability" },
        gamma: { id: "gamma", name: "Gamma", team: TEAM.MINION, ability: "Gamma ability" },
        omega: { id: "omega", name: "Omega", team: TEAM.DEMON, ability: "Omega ability" }
      }
    };
    const view = {
      scriptId: "mock-script",
      seat: 0,
      name: "A",
      day: 1,
      phase: "day",
      seats: [
        { seat: 0, name: "A", alive: true },
        { seat: 1, name: "B", alive: true },
        { seat: 2, name: "C", alive: true },
        { seat: 3, name: "D", alive: true },
        { seat: 4, name: "E", alive: true }
      ],
      log: [],
      nominations: [],
      you: {
        role: "alpha",
        roleName: "Alpha",
        teamLabel: "村民",
        alignmentLabel: "善良",
        alignment: "good",
        ability: "Alpha ability",
        alive: true,
        privateLog: []
      }
    };

    const prompt = buildSystemPrompt(view, "calm");

    expect(prompt).toContain("MOCK RULES ONLY");
    expect(prompt).toContain("Alpha ability");
    expect(prompt).not.toContain("小恶魔");
    expect(prompt).not.toContain("男爵");
  });
});