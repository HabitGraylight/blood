/**
 * 剧本可插拔性验证:注册一个全新的迷你剧本(纯配置 + 行为模块),
 * 不改动任何 core 代码即可完整运行"夜晚-白天-处决-胜负"循环,
 * 包括说书人裁量模式与自定义胜负判定。
 * 同时守护"core 层不出现具体角色 ID"的架构约束。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameEngine } from "../src/core/engine.js";
import { registerScript, assembleScript, TEAM, getScript } from "../src/scripts/registry.js";
import { setProtectedBy } from "../src/core/state.js";
import { ROLES as TB_ROLES } from "../src/scripts/trouble-brewing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `玩家${i}`, isHuman: i === 0
  }));
}

function voteAll(engine, nominator, nominee) {
  engine.dispatch({ type: "nominate", nominator, nominee });
  while (engine.state.currentVote) {
    const seat = engine.state.currentVote.order[engine.state.currentVote.index];
    engine.dispatch({ type: "vote", seat, up: true });
  }
}

const MINI_DATA = {
  id: "mini-test-script",
  scriptId: "mini-test-script",
  name: "迷你测试剧本",
  minPlayers: 5,
  maxPlayers: 5,
  setupTable: { 5: { townsfolk: 3, outsider: 0, minion: 1, demon: 1 } },
  roles: {
    seer: {
      id: "seer", name: "先知", team: TEAM.TOWNSFOLK, night: "both", input: false,
      ability: "每个夜晚,你会得到一条线索。"
    },
    guard: {
      id: "guard", name: "守卫", team: TEAM.TOWNSFOLK, night: "other", input: true,
      targets: 1, notSelf: true, prompt: "选择一名玩家守护",
      ability: "每个夜晚(首夜除外),守护一名其他玩家免受恶魔袭击。"
    },
    villager: {
      id: "villager", name: "平民", team: TEAM.TOWNSFOLK, night: null, input: false,
      ability: "没有能力。"
    },
    cultist: {
      id: "cultist", name: "教徒", team: TEAM.MINION, night: null, input: false,
      ability: "没有夜间行动。"
    },
    fiend: {
      id: "fiend", name: "梦魇", team: TEAM.DEMON, night: "other", input: true,
      targets: 1, prompt: "选择猎物",
      ability: "每个夜晚(首夜除外),杀死一名玩家。"
    }
  },
  nightOrder: {
    first: ["seer"],
    other: ["guard", "fiend", "seer"]
  },
  dayActions: []
};

const MINI_BEHAVIORS = {
  roles: {
    seer: {
      resolveNightInfo(ctx, player) {
        const corrupt = ctx.isCorrupt(player);
        if (ctx.stManual()) return ctx.requestInfoDecision(player, "seer", corrupt, null);
        ctx.tell(player.seat, "你梦到了线索A");
        return false;
      }
    },
    guard: {
      resolveNightChoice(ctx, player, targets) {
        const target = ctx.state.players[targets[0]];
        if (!ctx.isCorrupt(player)) setProtectedBy(target, player.seat, "guard");
        ctx.tell(player.seat, `你守护了 ${target.name}`, "action");
        return false;
      }
    },
    fiend: {
      shouldWake: (ctx, player) => player.alive && ctx.state.night > 1,
      resolveNightChoice(ctx, fiend, targets) {
        if (ctx.isCorrupt(fiend)) return false;
        ctx.demonKillFinal(targets[0]);
        return false;
      }
    }
  },
  buildNightInfoOptions(roleId) {
    if (roleId !== "seer") return null;
    return {
      detail: "先知线索裁量",
      options: [
        { label: "给线索A", text: "你梦到了线索A" },
        { label: "给线索B", text: "你梦到了线索B" }
      ]
    };
  }
};

const MINI_ROLES_5 = ["seer", "guard", "villager", "cultist", "fiend"];

registerScript(assembleScript(MINI_DATA, {
  scriptId: "mini-test-script",
  rulesBrief: "迷你剧本规则要点"
}, MINI_BEHAVIORS));

describe("新剧本可插拔(不改核心代码)", () => {
  it("auto 模式:夜晚信息/守护/夜杀/处决/胜负全流程可运行", () => {
    const engine = GameEngine.create(makePlayers(5), {
      seed: 42, scriptId: "mini-test-script", fixedRoles: MINI_ROLES_5
    });
    expect(engine.state.scriptName).toBe("迷你测试剧本");

    // 首夜:先知自动收到线索
    expect(engine.state.phase).toBe("day");
    expect(engine.state.players[0].privateLog.some((l) => l.text.includes("线索"))).toBe(true);

    // 白天:处决平民
    voteAll(engine, 0, 2);
    engine.dispatch({ type: "endDay" });
    expect(engine.state.players[2].alive).toBe(false);
    expect(engine.state.phase).toBe("night");

    // 第二夜:守卫守护先知,梦魇刀先知 → 守护生效
    let guard = 0;
    while (engine.state.phase === "night" && guard++ < 20) {
      const pa = engine.state.pendingAction;
      if (!pa) break;
      engine.dispatch({ type: "nightAction", seat: pa.seat, targets: [0] });
    }
    expect(engine.state.players[0].alive).toBe(true);
    expect(engine.state.phase).toBe("day");

    // 处决梦魇 → 善良获胜(默认胜负判定)
    voteAll(engine, 0, 4);
    engine.dispatch({ type: "endDay" });
    expect(engine.state.winner).toBe("good");
  });

  it("human 模式:新剧本的夜间信息通过 behaviors.buildNightInfoOptions 挂起裁量", () => {
    const engine = GameEngine.create(makePlayers(5), {
      seed: 43, scriptId: "mini-test-script", fixedRoles: MINI_ROLES_5,
      storytellerMode: "human"
    });
    const d = engine.state.pendingStorytellerDecision;
    expect(d).toBeTruthy();
    expect(d.type).toBe("night-info");
    expect(d.roleId).toBe("seer");
    const idx = d.options.findIndex((o) => o.label.includes("线索B"));
    engine.dispatch({ type: "storytellerDecide", decisionId: d.id, choice: idx });
    expect(engine.state.players[0].privateLog.some((l) => l.text.includes("线索B"))).toBe(true);
    expect(engine.state.phase).toBe("day");
  });

  it("剧本可通过 behaviors.checkWin 覆盖胜负判定", () => {
    registerScript(assembleScript(
      { ...MINI_DATA, id: "mini-test-script-v2", scriptId: "mini-test-script-v2", name: "迷你剧本V2" },
      { scriptId: "mini-test-script-v2" },
      {
        ...MINI_BEHAVIORS,
        // 自定义:只剩 3 名存活玩家邪恶即获胜(默认是 2 名)
        checkWin(players, script, defaultCheckWin) {
          const alive = players.filter((p) => p.alive);
          const demonAlive = alive.some((p) => script.roles[p.role].team === TEAM.DEMON);
          if (demonAlive && alive.length <= 3) {
            return { winner: "evil", reason: "V2规则:只剩三人,邪恶获胜!" };
          }
          return defaultCheckWin(players, script);
        }
      }
    ));
    const engine = GameEngine.create(makePlayers(5), {
      seed: 44, scriptId: "mini-test-script-v2", fixedRoles: MINI_ROLES_5
    });
    // 白天1处决平民(剩4人,未触发),夜里梦魇刀守卫(剩3人 → V2规则邪恶获胜)
    voteAll(engine, 0, 2);
    engine.dispatch({ type: "endDay" });
    expect(engine.state.winner).toBe(null);
    let guard = 0;
    while (engine.state.phase === "night" && guard++ < 20) {
      const pa = engine.state.pendingAction;
      if (!pa) break;
      engine.dispatch({ type: "nightAction", seat: pa.seat, targets: [pa.roleId === "fiend" ? 1 : 3] });
    }
    expect(engine.state.winner).toBe("evil");
    expect(engine.state.winReason).toContain("V2规则");
  });

  it("注册剧本后 getScript 可检索,且不影响默认剧本", () => {
    expect(getScript("mini-test-script").name).toBe("迷你测试剧本");
    expect(getScript().id).toBe("trouble-brewing");
  });
});

describe("架构守护:core 层与具体剧本解耦", () => {
  it("core 层源码不出现任何 TB 角色 ID(state.js 的存档兼容层除外)", () => {
    const coreDir = path.resolve(__dirname, "../src/core");
    // state.js 保留旧存档字段映射(believedRole/master 等历史键),豁免扫描
    const files = fs.readdirSync(coreDir).filter((f) => f.endsWith(".js") && f !== "state.js");
    const roleIds = Object.keys(TB_ROLES);
    for (const file of files) {
      const src = fs.readFileSync(path.join(coreDir, file), "utf8");
      for (const id of roleIds) {
        expect(
          src.includes(`"${id}"`) || src.includes(`'${id}'`),
          `src/core/${file} 不应引用角色 "${id}"`
        ).toBe(false);
      }
    }
  });
});
