import { describe, expect, it } from "vitest";
import { getScript } from "../src/scripts/registry.js";
import {
  assertNoLeak,
  buildSharedSystemBlocks,
  buildPlayerSystemBlocks,
  buildPublicChatBlock,
  buildSystemPrompt
} from "../src/ai/prompts.js";
import { enforceConstraints } from "../src/ai/aiController.js";

/** 构造一个最小但合法的 playerView 测试桩 */
function makeView(overrides = {}) {
  const script = getScript("trouble-brewing");
  const seats = overrides.seats || [
    { seat: 0, name: "张三", alive: true, ghostVote: false, isHuman: false },
    { seat: 1, name: "李四", alive: true, ghostVote: false, isHuman: true },
    { seat: 2, name: "王五", alive: true, ghostVote: false, isHuman: false },
  ];
  const you = overrides.you || {
    role: "washerwoman",
    roleName: "洗衣妇",
    team: 0,
    teamLabel: "村民",
    alignment: "good",
    alignmentLabel: "善良",
    ability: "首夜得知两名玩家中谁是某特定村民",
    alive: true,
    ghostVote: false,
    usedAbility: false,
    master: null,
    privateLog: [{ night: 1, text: "你得知 2号或3号玩家是图书管理员" }],
    evilInfo: null,
  };
  return {
    scriptId: "trouble-brewing",
    scriptName: script.name,
    seat: overrides.seat != null ? overrides.seat : 0,
    name: seats[0].name,
    phase: "day",
    dayStage: "discussion",
    night: overrides.night || 2,
    day: overrides.day || 2,
    seats,
    you,
    nominations: [],
    nominatedToday: [],
    nominatorsToday: [],
    onBlock: null,
    currentVote: null,
    log: [],
    announcements: [],
    dailySummaries: overrides.dailySummaries || [],
    ...overrides,
  };
}

/* ---------------- assertNoLeak ---------------- */

describe("assertNoLeak 安全断言", () => {
  const whitelist = Object.values(getScript("trouble-brewing").roles).map((r) => r.name);

  it("允许公开内容(规则+推理+人数配置+白名单+玩家名+座位号)", () => {
    const text = [
      "<role_whitelist>全部合法角色名:",
      "◆ 村民: 洗衣妇、占卜师",
      "</role_whitelist>",
      "<player_count_config>7人局标准配置</player_count_config>",
      "<reasoning_method>发言前在心里完成推理</reasoning_method>",
      "3号 张三: 我跳洗衣妇",
      "5号 李四: 我觉得3号可疑"
    ].join("\n");
    expect(() => assertNoLeak(text, whitelist)).not.toThrow();
  });

  it("拒绝玩家私密 XML 标签(<your_seat>/<evil_info>/<private_log>等)", () => {
    expect(() => assertNoLeak("<your_seat>你是 3号</your_seat>", whitelist)).toThrow(/私密标记/);
    expect(() => assertNoLeak("<your_identity>能力: 占卜</your_identity>", whitelist)).toThrow(/私密标记/);
    expect(() => assertNoLeak("<evil_info>恶魔是 2号</evil_info>", whitelist)).toThrow(/私密标记/);
    expect(() => assertNoLeak("<bluffs>洗衣妇、厨师</bluffs>", whitelist)).toThrow(/私密标记/);
    expect(() => assertNoLeak("<private_log>内容</private_log>", whitelist)).toThrow(/私密标记/);
    expect(() => assertNoLeak("<memo>推理档案</memo>", whitelist)).toThrow(/私密标记/);
    expect(() => assertNoLeak("<persona>冷静</persona>", whitelist)).toThrow(/私密标记/);
  });

  it("拒绝纯文本私密标记(兜底)", () => {
    expect(() => assertNoLeak("你是 3号玩家", whitelist)).toThrow(/私密标记/);
    expect(() => assertNoLeak("你的身份是占卜师", whitelist)).toThrow(/私密标记/);
  });

  it("拒绝角色能力描述文本", () => {
    expect(() => assertNoLeak("【要点: 红鲱鱼】", whitelist)).toThrow(/能力描述/);
    expect(() => assertNoLeak(": 你每晚可以选择一个", whitelist)).toThrow(/能力描述/);
  });

  it("白名单内的角色纯名字不触发能力检测(角色名前缀不跟能力描述)", () => {
    // 纯角色名列表是合法的白名单内容
    expect(() => assertNoLeak("◆ 村民: 洗衣妇、占卜师、厨师", whitelist)).not.toThrow();
  });
});

/* ---------------- 共享块与玩家块拆分 ---------------- */

describe("buildSharedSystemBlocks(共享缓存块)", () => {
  it("Block1 文本不含任何玩家私密信息(通过 assertNoLeak)", () => {
    const view = makeView();
    const chatHistory = [
      { fromSeat: 1, fromName: "李四", text: "我跳占卜师", to: null },
    ];

    // 直接调用不应抛错(内部调用了 assertNoLeak)
    const blocks = buildSharedSystemBlocks(view, chatHistory);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[0].text.length).toBeGreaterThan(500);
  });

  it("Block1 多AI玩家共享时前缀完全一致", () => {
    const viewA = makeView({ seat: 0, name: "张三" });
    const viewB = makeView({ seat: 1, name: "李四" });
    const chat = [];

    const blocksA = buildSharedSystemBlocks(viewA, chat);
    const blocksB = buildSharedSystemBlocks(viewB, chat);

    // Block1 对所有玩家完全相同(不含座位/身份/能力)
    expect(blocksA[0].text).toBe(blocksB[0].text);
  });

  it("当天有公开聊天时 buildPublicChatBlock 返回 XML 聊天文本", () => {
    const chat = [
      { fromSeat: 1, fromName: "李四", text: "我跳占卜师", to: null },
      { fromSeat: 2, fromName: "王五", text: "我怀疑张三", to: null },
    ];
    const chatBlock = buildPublicChatBlock(chat);
    expect(chatBlock).toContain("<public_chat>");
    expect(chatBlock).toContain("李四");
    expect(chatBlock).toContain("王五");
    expect(chatBlock).toContain("</public_chat>");
  });

  it("无公开聊天时 buildPublicChatBlock 返回空字符串", () => {
    expect(buildPublicChatBlock([])).toBe("");
  });

  it("历史每日摘要注入 Block1", () => {
    const view = makeView({
      dailySummaries: [
        { day: 1, text: "第一天无人处决,玩家各自试探身份" },
      ],
    });
    const blocks = buildSharedSystemBlocks(view, []);
    expect(blocks[0].text).toContain("<daily_summaries>");
    expect(blocks[0].text).toContain("无人处决");
  });
});

describe("buildPlayerSystemBlocks(玩家专属块)", () => {
  it("包含玩家座位、身份、能力、私密信息", () => {
    const view = makeView();
    const chatHistory = [{ fromSeat: 1, fromName: "李四", text: "我跳占卜师", to: null }];
    const blocks = buildPlayerSystemBlocks(view, "冷静理性", null, chatHistory);

    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("text");
    // 不应有 cache_control(玩家专属信息不跨 AI 共享)
    expect(blocks[0].cache_control).toBeUndefined;

    const text = blocks[0].text;
    expect(text).toContain("<your_seat>");
    expect(text).toContain("<your_identity>");
    expect(text).toContain("<role_strategy>");
    expect(text).toContain("<private_log>");
    expect(text).toContain("洗衣妇");
  });

  it("邪恶阵营玩家包含邪恶情报与伪装", () => {
    const view = makeView({
      you: {
        role: "fortuneteller",
        roleName: "占卜师",
        team: 2,
        teamLabel: "爪牙",
        alignment: "evil",
        alignmentLabel: "邪恶",
        ability: "每夜选择两名玩家,得知其中是否有恶魔",
        alive: true,
        ghostVote: false,
        usedAbility: false,
        master: null,
        privateLog: [],
        evilInfo: {
          demonSeat: 2,
          minionSeats: [0],
          bluffs: ["washerwoman", "chef"],
        },
      },
    });
    const blocks = buildPlayerSystemBlocks(view, "阴险狡诈", null, []);
    const text = blocks[0].text;
    expect(text).toContain("<evil_info>");
    expect(text).toContain("<bluffs>");
  });
});

/* ---------------- RAG 角色检索 ---------------- */

describe("RAG 角色检索(scriptRolesBriefRAG)", () => {
  // scriptRolesBriefRAG is internal, tested through buildPlayerSystemBlocks
  it("Block3 只注入自己角色+公开声称过的角色+伪装池角色,不含无关角色", () => {
    const view = makeView({
      you: {
        role: "chef",
        roleName: "厨师",
        team: 0,
        teamLabel: "村民",
        alignment: "good",
        alignmentLabel: "善良",
        ability: "得知多少对邪恶玩家相邻",
        alive: true,
        ghostVote: false,
        usedAbility: false,
        master: null,
        privateLog: [],
        evilInfo: null,
      },
    });
    const chatHistory = [
      { fromSeat: 1, fromName: "李四", text: "我是占卜师,首夜查了", to: null },
      { fromSeat: 2, fromName: "王五", text: "我跳洗衣妇", to: null },
    ];

    const blocks = buildPlayerSystemBlocks(view, "冷静理性", null, chatHistory);
    const text = blocks[0].text;

    // 应包含:自己角色(厨师) + 声称角色(占卜师、洗衣妇)
    expect(text).toContain("<known_role_abilities>");
    expect(text).toContain("厨师");
    expect(text).toContain("占卜师");
    expect(text).toContain("洗衣妇");

    // 不应包含未声称的无关角色(如士兵、隐士、圣徒等)
    // 粗略检查:角色能力段长度应远小于全量表(~1500+ token)
    const ragSection = text.split("<known_role_abilities>")[1]?.split("</known_role_abilities>")[0] || "";
    expect(ragSection.length).toBeLessThan(1500);
  });

  it("邪恶玩家伪装池角色出现在RAG注入中", () => {
    const view = makeView({
      you: {
        role: "fortuneteller",
        roleName: "占卜师",
        team: 2,
        teamLabel: "爪牙",
        alignment: "evil",
        alignmentLabel: "邪恶",
        ability: "每夜选择两名玩家,得知其中是否有恶魔",
        alive: true,
        ghostVote: false,
        usedAbility: false,
        master: null,
        privateLog: [],
        evilInfo: {
          demonSeat: 2,
          minionSeats: [0],
          bluffs: ["soldier", "monk"],
        },
      },
    });
    const blocks = buildPlayerSystemBlocks(view, "阴险狡诈", null, []);
    const text = blocks[0].text;
    expect(text).toContain("士兵");
    expect(text).toContain("僧侣");
  });
});

/* ---------------- 兼容包装 ---------------- */

describe("buildSystemPrompt(兼容回退)", () => {
  it("拼合共享块与玩家块为单一字符串", () => {
    const view = makeView();
    const text = buildSystemPrompt(view, "冷静", null);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(500);
    // 应同时包含公共内容(白名单)和私密内容(玩家标签)
    expect(text).toContain("<role_whitelist>");
    expect(text).toContain("<your_identity>");
  });
});

/* ---------------- enforceConstraints ---------------- */

describe("enforceConstraints 统一约束校验", () => {
  it("存活目标通过校验", () => {
    const view = makeView();
    expect(enforceConstraints(view, { target: 1, aliveOnly: true })).toBe(true);
  });

  it("死亡目标被拒绝", () => {
    const view = makeView({
      seats: [
        { seat: 0, name: "张三", alive: true },
        { seat: 1, name: "李四", alive: false },
        { seat: 2, name: "王五", alive: true },
      ],
    });
    expect(enforceConstraints(view, { target: 1, aliveOnly: true })).toBe(false);
  });

  it("选择自己被拒绝(notSelf)", () => {
    const view = makeView({ seat: 0 });
    expect(enforceConstraints(view, { target: 0, notSelf: true })).toBe(false);
  });

  it("多目标中任一死亡则整体拒绝", () => {
    const view = makeView({
      seats: [
        { seat: 0, name: "张三", alive: true },
        { seat: 1, name: "李四", alive: false },
        { seat: 2, name: "王五", alive: true },
      ],
    });
    expect(enforceConstraints(view, { targets: [0, 2], aliveOnly: true })).toBe(true);
    expect(enforceConstraints(view, { targets: [1, 2], aliveOnly: true })).toBe(false);
  });

  it("空目标数组返回 false", () => {
    expect(enforceConstraints(makeView(), { targets: [], aliveOnly: true })).toBe(false);
  });

  it("target=null 通过校验", () => {
    expect(enforceConstraints(makeView(), { target: null, aliveOnly: true })).toBe(true);
  });
});

/* ---------------- 缓存块前缀跨玩家一致性 ---------------- */

describe("多AI玩家缓存共享验证", () => {
  it("不同座位AI的 Block1 前缀完全相同", () => {
    const seats = [
      { seat: 0, name: "张三", alive: true, ghostVote: false },
      { seat: 1, name: "李四", alive: true, ghostVote: false },
      { seat: 2, name: "王五", alive: true, ghostVote: false },
    ];
    const view0 = makeView({ seat: 0, seats, name: "张三" });
    const view1 = makeView({ seat: 1, seats, name: "李四" });
    const view2 = makeView({ seat: 2, seats, name: "王五" });

    const block0 = buildSharedSystemBlocks(view0, [])[0].text;
    const block1 = buildSharedSystemBlocks(view1, [])[0].text;
    const block2 = buildSharedSystemBlocks(view2, [])[0].text;

    expect(block0).toBe(block1);
    expect(block0).toBe(block2);
  });

  it("Block3(玩家块)在不同座位间各不相同", () => {
    const seats = [
      { seat: 0, name: "张三", alive: true, ghostVote: false },
      { seat: 1, name: "李四", alive: true, ghostVote: false },
    ];
    const view0 = makeView({ seat: 0, seats, name: "张三" });
    const view1 = makeView({ seat: 1, seats, name: "李四" });

    const block0 = buildPlayerSystemBlocks(view0, "冷静", null, [])[0].text;
    const block1 = buildPlayerSystemBlocks(view1, "冷静", null, [])[0].text;

    // 应不同:每AI独有的座位/身份信息不同
    expect(block0).not.toBe(block1);
  });
});
