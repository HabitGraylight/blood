import { describe, it, expect } from "vitest";
import { GameEngine } from "../src/core/engine.js";
import { drawRoles } from "../src/core/setup.js";
import { resolveVoteResult, checkWin } from "../src/core/rules.js";
import { createRng } from "../src/core/rng.js";
import { ROLES, TEAM, SETUP_TABLE } from "../src/scripts/trouble-brewing.js";
import { playerView, storytellerView } from "../src/core/view.js";

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `玩家${i}`, isHuman: i === 0
  }));
}

/** 自动响应夜间行动:给挂起的选择填一个合法目标 */
function autoNight(engine) {
  let guard = 0;
  while (engine.state.phase === "night" && guard++ < 100) {
    const pa = engine.state.pendingAction;
    if (!pa) break;
    const alive = engine.state.players.filter((p) => p.alive && p.seat !== pa.seat);
    const targets = [];
    for (let i = 0; i < pa.targets; i++) targets.push(alive[i % alive.length].seat);
    const res = engine.dispatch({ type: "nightAction", seat: pa.seat, targets });
    expect(res.ok).toBe(true);
  }
}

describe("发牌与配置表", () => {
  it("各人数的身份分布符合配置表", () => {
    for (let n = 5; n <= 15; n++) {
      const rng = createRng(42 + n);
      const { roles, composition } = drawRoles(n, rng);
      expect(roles.length).toBe(n);
      const counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
      for (const id of roles) counts[ROLES[id].team]++;
      // 男爵会 +2 外来者 -2 村民
      if (roles.includes("baron")) {
        expect(counts.outsider).toBe(SETUP_TABLE[n].outsider + 2);
        expect(counts.townsfolk).toBe(SETUP_TABLE[n].townsfolk - 2);
      } else {
        expect(counts).toEqual(SETUP_TABLE[n]);
      }
      expect(counts.demon).toBe(1);
      expect(composition.demon).toBe(1);
    }
  });

  it("酒鬼获得不在场的村民伪装身份", () => {
    const engine = GameEngine.create(makePlayers(8), {
      seed: 1,
      fixedRoles: ["drunk", "empath", "chef", "soldier", "mayor", "saint", "poisoner", "imp"]
    });
    const drunk = engine.state.players[0];
    expect(drunk.believedRole).toBeTruthy();
    expect(ROLES[drunk.believedRole].team).toBe(TEAM.TOWNSFOLK);
    const inPlay = engine.state.players.map((p) => p.role);
    expect(inPlay).not.toContain(drunk.believedRole);
  });
});

describe("投票判定", () => {
  it("得票达到存活半数且超过最高票才上处决台", () => {
    expect(resolveVoteResult(3, 7, null).outcome).toBe("fail"); // 7人需4票
    expect(resolveVoteResult(4, 7, null).outcome).toBe("block");
    expect(resolveVoteResult(4, 7, { seat: 1, votes: 4 }).outcome).toBe("tie");
    expect(resolveVoteResult(5, 7, { seat: 1, votes: 4 }).outcome).toBe("block");
    expect(resolveVoteResult(4, 7, { seat: 1, votes: 5 }).outcome).toBe("fail");
    expect(resolveVoteResult(3, 6, null).outcome).toBe("block"); // 6人需3票
  });
});

describe("胜负条件", () => {
  it("恶魔死亡善良获胜;只剩两人邪恶获胜", () => {
    const mk = (roles, aliveFlags) =>
      roles.map((role, i) => ({ role, alive: aliveFlags[i], alignment: "good" }));
    expect(checkWin(mk(["imp", "chef", "mayor"], [false, true, true])).winner).toBe("good");
    expect(checkWin(mk(["imp", "chef", "mayor"], [true, true, false])).winner).toBe("evil");
    expect(checkWin(mk(["imp", "chef", "mayor"], [true, true, true]))).toBe(null);
  });
});

describe("完整对局流程", () => {
  const ROLES_7 = ["washerwoman", "empath", "fortuneteller", "monk", "soldier", "poisoner", "imp"];

  it("首夜按顺序行动,天亮进入白天", () => {
    const engine = GameEngine.create(makePlayers(7), { seed: 7, fixedRoles: ROLES_7 });
    expect(engine.state.phase).toBe("night");
    autoNight(engine);
    expect(engine.state.phase).toBe("day");
    expect(engine.state.day).toBe(1);
    // 首夜信息角色收到私密信息
    expect(engine.state.players[0].privateLog.length).toBeGreaterThan(0); // 洗衣妇
    expect(engine.state.players[1].privateLog.length).toBeGreaterThan(0); // 共情者
    // 首夜恶魔/爪牙互认(7人局)
    const impLog = engine.state.players[6].privateLog.map((l) => l.text).join();
    expect(impLog).toContain("爪牙");
  });

  it("提名-投票-处决流程,处决后入夜", () => {
    const engine = GameEngine.create(makePlayers(7), { seed: 7, fixedRoles: ROLES_7 });
    autoNight(engine);
    const res = engine.dispatch({ type: "nominate", nominator: 0, nominee: 5 });
    expect(res.ok).toBe(true);
    expect(engine.state.dayStage).toBe("voting");
    // 所有人投赞成
    while (engine.state.currentVote) {
      const seat = engine.state.currentVote.order[engine.state.currentVote.index];
      engine.dispatch({ type: "vote", seat, up: true });
    }
    expect(engine.state.onBlock.seat).toBe(5);
    engine.dispatch({ type: "endDay" });
    // 投毒者被处决 → 夜晚开始
    expect(engine.state.players[5].alive).toBe(false);
    expect(engine.state.phase).toBe("night");
    expect(engine.state.night).toBe(2);
  });

  it("死亡玩家只有一次遗书票", () => {
    const engine = GameEngine.create(makePlayers(7), { seed: 7, fixedRoles: ROLES_7 });
    autoNight(engine);
    // 处决 4 号(士兵)
    engine.dispatch({ type: "nominate", nominator: 0, nominee: 4 });
    while (engine.state.currentVote) {
      const seat = engine.state.currentVote.order[engine.state.currentVote.index];
      engine.dispatch({ type: "vote", seat, up: true });
    }
    engine.dispatch({ type: "endDay" });
    autoNight(engine); // 第二夜
    expect(engine.state.phase).toBe("day");
    const dead = engine.state.players[4];
    if (!dead.alive) {
      expect(dead.ghostVote).toBe(true);
      engine.dispatch({ type: "nominate", nominator: 0, nominee: 5 });
      while (engine.state.currentVote) {
        const seat = engine.state.currentVote.order[engine.state.currentVote.index];
        engine.dispatch({ type: "vote", seat, up: true });
      }
      expect(dead.ghostVote).toBe(false); // 遗书票已用
    }
  });

  it("士兵不会被恶魔杀死", () => {
    const engine = GameEngine.create(makePlayers(7), { seed: 11, fixedRoles: ROLES_7 });
    autoNight(engine);
    engine.dispatch({ type: "endDay" }); // 无处决入夜
    // 第二夜:投毒者行动 → 僧侣行动 → 小恶魔行动
    let guard = 0;
    while (engine.state.phase === "night" && guard++ < 50) {
      const pa = engine.state.pendingAction;
      if (!pa) break;
      if (pa.roleId === "imp") {
        engine.dispatch({ type: "nightAction", seat: pa.seat, targets: [4] }); // 杀士兵
      } else if (pa.roleId === "monk") {
        engine.dispatch({ type: "nightAction", seat: pa.seat, targets: [0] });
      } else if (pa.roleId === "poisoner") {
        engine.dispatch({ type: "nightAction", seat: pa.seat, targets: [1] }); // 毒共情者
      } else {
        const alive = engine.state.players.filter((p) => p.alive && p.seat !== pa.seat);
        const targets = [];
        for (let i = 0; i < pa.targets; i++) targets.push(alive[i % alive.length].seat);
        engine.dispatch({ type: "nightAction", seat: pa.seat, targets });
      }
    }
    expect(engine.state.players[4].alive).toBe(true); // 士兵存活
    expect(engine.state.players[1].poisonedBy).toBe(5); // 共情者中毒
  });

  it("僧侣保护目标免受恶魔杀害", () => {
    const engine = GameEngine.create(makePlayers(7), { seed: 13, fixedRoles: ROLES_7 });
    autoNight(engine);
    engine.dispatch({ type: "endDay" });
    let guard = 0;
    while (engine.state.phase === "night" && guard++ < 50) {
      const pa = engine.state.pendingAction;
      if (!pa) break;
      if (pa.roleId === "imp") {
        engine.dispatch({ type: "nightAction", seat: pa.seat, targets: [1] });
      } else if (pa.roleId === "monk") {
        engine.dispatch({ type: "nightAction", seat: pa.seat, targets: [1] }); // 保护共情者
      } else if (pa.roleId === "poisoner") {
        engine.dispatch({ type: "nightAction", seat: pa.seat, targets: [0] });
      } else {
        const alive = engine.state.players.filter((p) => p.alive && p.seat !== pa.seat);
        const targets = [];
        for (let i = 0; i < pa.targets; i++) targets.push(alive[i % alive.length].seat);
        engine.dispatch({ type: "nightAction", seat: pa.seat, targets });
      }
    }
    expect(engine.state.players[1].alive).toBe(true);
  });

  it("处决圣徒邪恶获胜", () => {
    const engine = GameEngine.create(makePlayers(8), {
      seed: 17,
      fixedRoles: ["chef", "empath", "monk", "soldier", "mayor", "saint", "poisoner", "imp"]
    });
    // 首夜:确保投毒者不毒圣徒
    let guard = 0;
    while (engine.state.phase === "night" && guard++ < 50) {
      const pa = engine.state.pendingAction;
      if (!pa) break;
      const target = pa.roleId === "poisoner" ? 0 : 1;
      const targets = pa.targets === 2 ? [0, 1] : [target];
      engine.dispatch({ type: "nightAction", seat: pa.seat, targets });
    }
    engine.dispatch({ type: "nominate", nominator: 0, nominee: 5 });
    while (engine.state.currentVote) {
      const seat = engine.state.currentVote.order[engine.state.currentVote.index];
      engine.dispatch({ type: "vote", seat, up: true });
    }
    engine.dispatch({ type: "endDay" });
    expect(engine.state.winner).toBe("evil");
  });

  it("处决小恶魔且无猩红夫人时善良获胜", () => {
    const engine = GameEngine.create(makePlayers(7), { seed: 19, fixedRoles: ROLES_7 });
    autoNight(engine);
    engine.dispatch({ type: "nominate", nominator: 0, nominee: 6 });
    while (engine.state.currentVote) {
      const seat = engine.state.currentVote.order[engine.state.currentVote.index];
      engine.dispatch({ type: "vote", seat, up: true });
    }
    engine.dispatch({ type: "endDay" });
    expect(engine.state.winner).toBe("good");
  });

  it("处决小恶魔时猩红夫人变身(存活>=5)", () => {
    const engine = GameEngine.create(makePlayers(7), {
      seed: 23,
      fixedRoles: ["chef", "empath", "monk", "soldier", "mayor", "scarletwoman", "imp"]
    });
    autoNight(engine);
    engine.dispatch({ type: "nominate", nominator: 0, nominee: 6 });
    while (engine.state.currentVote) {
      const seat = engine.state.currentVote.order[engine.state.currentVote.index];
      engine.dispatch({ type: "vote", seat, up: true });
    }
    engine.dispatch({ type: "endDay" });
    expect(engine.state.winner).toBe(null); // 游戏继续
    expect(engine.state.players[5].role).toBe("imp"); // 猩红夫人变身
  });

  it("圣女被村民提名时提名者被处决", () => {
    const engine = GameEngine.create(makePlayers(7), {
      seed: 29,
      fixedRoles: ["chef", "virgin", "monk", "soldier", "mayor", "poisoner", "imp"]
    });
    // 首夜投毒者不毒圣女和厨师
    let guard = 0;
    while (engine.state.phase === "night" && guard++ < 50) {
      const pa = engine.state.pendingAction;
      if (!pa) break;
      engine.dispatch({ type: "nightAction", seat: pa.seat, targets: pa.targets === 2 ? [3, 4] : [4] });
    }
    const res = engine.dispatch({ type: "nominate", nominator: 0, nominee: 1 });
    expect(res.ok).toBe(true);
    expect(engine.state.players[0].alive).toBe(false); // 厨师(村民)被立刻处决
    expect(engine.state.phase).toBe("night"); // 处决后入夜
  });


  it("猩红夫人在恶魔死亡前正好5人存活时变身", () => {
    const engine = GameEngine.create(makePlayers(5), {
      seed: 201,
      fixedRoles: ["chef", "soldier", "scarletwoman", "baron", "imp"]
    });
    autoNight(engine);
    engine.dispatch({ type: "nominate", nominator: 0, nominee: 4 });
    while (engine.state.currentVote) {
      const seat = engine.state.currentVote.order[engine.state.currentVote.index];
      engine.dispatch({ type: "vote", seat, up: true });
    }
    engine.dispatch({ type: "endDay" });
    expect(engine.state.winner).toBe(null);
    expect(engine.state.players[2].role).toBe("imp");
  });

  it("管家在主人稍后会投票时可以计票", () => {
    const engine = GameEngine.create(makePlayers(5), {
      seed: 202,
      fixedRoles: ["butler", "chef", "soldier", "baron", "imp"]
    });
    autoNight(engine);
    engine.state.players[0].master = 1;
    engine.dispatch({ type: "nominate", nominator: 2, nominee: 4 });
    engine.dispatch({ type: "vote", seat: engine.state.currentVote.order[0], up: "master-up" });
    while (engine.state.currentVote) {
      const seat = engine.state.currentVote.order[engine.state.currentVote.index];
      engine.dispatch({ type: "vote", seat, up: seat === 0 || seat === 1 });
    }
    const last = engine.state.nominations.at(-1);
    expect(last.voters).toContain(0);
    expect(last.voters).toContain(1);
  });

  it("占卜师红鲱鱼可以是自己", () => {
    let found = false;
    for (let seed = 300; seed < 380; seed++) {
      const engine = GameEngine.create(makePlayers(5), {
        seed,
        fixedRoles: ["fortuneteller", "chef", "soldier", "baron", "imp"]
      });
      if (engine.state.players[0].redHerring) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("非杀手声称开枪不会消耗圣女能力", () => {
    const engine = GameEngine.create(makePlayers(5), {
      seed: 203,
      fixedRoles: ["virgin", "chef", "soldier", "baron", "imp"]
    });
    autoNight(engine);
    const shot = engine.dispatch({ type: "slayerShot", seat: 0, target: 4 });
    expect(shot.ok).toBe(true);
    expect(engine.state.players[0].usedAbility).toBe(false);
    expect(engine.state.players[0].slayerUsed).toBe(true);
  });
  it("序列化后可恢复继续游戏", () => {
    const engine = GameEngine.create(makePlayers(7), { seed: 31, fixedRoles: ROLES_7 });
    autoNight(engine);
    const snapshot = engine.serialize();
    const restored = GameEngine.hydrate(snapshot);
    const res = restored.dispatch({ type: "nominate", nominator: 0, nominee: 5 });
    expect(res.ok).toBe(true);
    expect(restored.state.dayStage).toBe("voting");
  });


  it("说书人视图能看完整魔典,玩家视图不能看他人身份", () => {
    const engine = GameEngine.create(makePlayers(5), {
      seed: 204,
      fixedRoles: ["chef", "soldier", "scarletwoman", "baron", "imp"]
    });
    const st = storytellerView(engine.state);
    const pv = playerView(engine.state, 0);
    expect(st.isStoryteller).toBe(true);
    expect(st.seats[4].role).toBe("imp");
    expect(pv.seats[4].revealedRole).toBe(null);
  });
  it("auto 模式永远不会产生待裁定事项", () => {
    const engine = GameEngine.create(makePlayers(7), { seed: 7, fixedRoles: ROLES_7 });
    autoNight(engine);
    expect(engine.state.pendingStorytellerDecision).toBe(null);
  });

  it("随机对局最终总会分出胜负", () => {
    for (let seed = 100; seed < 105; seed++) {
      const engine = GameEngine.create(makePlayers(9), { seed });
      const rng = createRng(seed * 7);
      let guard = 0;
      while (!engine.state.winner && guard++ < 500) {
        const s = engine.state;
        if (s.phase === "night") {
          const pa = s.pendingAction;
          if (!pa) break;
          const pool = s.players.filter((p) => (p.alive || pa.roleId === "ravenkeeper") && !(pa.notSelf && p.seat === pa.seat));
          const targets = [];
          for (let i = 0; i < pa.targets; i++) targets.push(rng.pick(pool).seat);
          engine.dispatch({ type: "nightAction", seat: pa.seat, targets });
        } else if (s.dayStage === "voting") {
          const seat = s.currentVote.order[s.currentVote.index];
          engine.dispatch({ type: "vote", seat, up: rng.chance(0.6) });
        } else if (s.phase === "day") {
          // 随机提名或结束白天
          const alive = s.players.filter((p) => p.alive);
          const nominators = alive.filter((p) => !s.nominatorsToday.includes(p.seat));
          const nominees = alive.filter((p) => !s.nominatedToday.includes(p.seat));
          if (nominators.length && nominees.length && rng.chance(0.7)) {
            engine.dispatch({
              type: "nominate",
              nominator: rng.pick(nominators).seat,
              nominee: rng.pick(nominees).seat
            });
          } else {
            engine.dispatch({ type: "endDay" });
          }
        }
      }
      expect(engine.state.winner).toBeTruthy();
    }
  });
});

describe("说书人裁量(决策挂起)", () => {
  /** human 模式下推进夜晚:自动应答裁定(可按类型定制)与夜间选择 */
  function runNight(engine, deciders = {}, nightActions = {}) {
    let guard = 0;
    const seen = [];
    while (engine.state.phase === "night" && guard++ < 300) {
      const d = engine.state.pendingStorytellerDecision;
      if (d) {
        seen.push(d);
        const choice = deciders[d.type] ? deciders[d.type](d) : d.defaultIndex;
        const res = engine.dispatch({ type: "storytellerDecide", decisionId: d.id, choice });
        expect(res.ok).toBe(true);
        continue;
      }
      const pa = engine.state.pendingAction;
      if (!pa) break;
      let targets;
      if (nightActions[pa.roleId]) {
        targets = nightActions[pa.roleId](engine.state);
      } else {
        const alive = engine.state.players.filter((p) => p.alive && p.seat !== pa.seat);
        targets = [];
        for (let i = 0; i < pa.targets; i++) targets.push(alive[i % alive.length].seat);
      }
      engine.dispatch({ type: "nightAction", seat: pa.seat, targets });
    }
    return seen;
  }

  function humanGame(n, seed, fixedRoles) {
    return GameEngine.create(makePlayers(n), { seed, fixedRoles, storytellerMode: "human" });
  }

  it("首夜挂起酒鬼伪装裁量,改选后生效", () => {
    const engine = humanGame(8, 1, ["drunk", "empath", "chef", "soldier", "mayor", "saint", "poisoner", "imp"]);
    const d = engine.state.pendingStorytellerDecision;
    expect(d).toBeTruthy();
    expect(d.type).toBe("setup-drunk");
    // 选一个非默认且非占卜师的伪装(避免触发红鲱鱼分支影响断言)
    const idx = d.options.findIndex(
      (o) => !o.label.includes("(默认)") && o.value.roleId !== "fortuneteller"
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    const chosen = d.options[idx].value.roleId;
    engine.dispatch({ type: "storytellerDecide", decisionId: d.id, choice: idx });
    expect(engine.state.players[0].believedRole).toBe(chosen);
    // 无占卜师 → 无红鲱鱼裁量,继续夜晚
    runNight(engine);
    expect(engine.state.phase).toBe("day");
  });

  it("首夜挂起红鲱鱼裁量,改选后红鲱鱼转移", () => {
    const engine = humanGame(7, 7, ["washerwoman", "empath", "fortuneteller", "monk", "soldier", "poisoner", "imp"]);
    const d = engine.state.pendingStorytellerDecision;
    expect(d.type).toBe("setup-redherring");
    // 指定 0 号为红鲱鱼
    const idx = d.options.findIndex((o) => o.value.seat === 0);
    engine.dispatch({ type: "storytellerDecide", decisionId: d.id, choice: idx });
    expect(engine.state.players[0].redHerring).toBe(true);
    expect(engine.state.players.filter((p) => p.redHerring).length).toBe(1);
  });

  it("挂起期间普通玩家动作被冻结", () => {
    const engine = humanGame(7, 7, ["washerwoman", "empath", "fortuneteller", "monk", "soldier", "poisoner", "imp"]);
    expect(engine.state.pendingStorytellerDecision).toBeTruthy();
    const res = engine.dispatch({ type: "nominate", nominator: 0, nominee: 5 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("说书人");
  });

  it("中毒共情者的信息由说书人从 0/1/2 中裁定", () => {
    const engine = humanGame(7, 7, ["washerwoman", "empath", "fortuneteller", "monk", "soldier", "poisoner", "imp"]);
    let empathDecision = null;
    runNight(engine, {
      "night-info": (d) => {
        if (d.roleId === "empath" && engine.state.players[1].poisonedBy != null) {
          empathDecision = d;
          // 选最大值(明显假信息)
          return d.options.length - 1;
        }
        return d.defaultIndex;
      }
    }, {
      poisoner: () => [1] // 毒共情者
    });
    expect(engine.state.phase).toBe("day");
    expect(empathDecision).toBeTruthy();
    expect(empathDecision.options.length).toBe(3); // 0/1/2
    const lastInfo = engine.state.players[1].privateLog.at(-1);
    expect(lastInfo.text).toContain("2 名邪恶玩家");
  });

  it("清醒且无间谍/隐士时,厨师与共情者不产生裁量", () => {
    const engine = humanGame(7, 7, ["chef", "empath", "fortuneteller", "monk", "soldier", "poisoner", "imp"]);
    const seen = runNight(engine, {}, { poisoner: () => [3] }); // 毒僧侣,不影响信息角色
    expect(engine.state.phase).toBe("day");
    const infoDecisions = seen.filter((d) => d.type === "night-info");
    expect(infoDecisions.every((d) => d.roleId !== "chef" && d.roleId !== "empath")).toBe(true);
    // 但他们依然收到了唯一的真实信息
    expect(engine.state.players[0].privateLog.some((l) => l.text.includes("相邻的邪恶玩家"))).toBe(true);
    expect(engine.state.players[1].privateLog.some((l) => l.text.includes("邪恶玩家"))).toBe(true);
  });

  it("镇长被刀时挂起转移裁量,转移后替死者死亡", () => {
    const engine = humanGame(7, 11, ["chef", "empath", "fortuneteller", "monk", "mayor", "poisoner", "imp"]);
    runNight(engine, {}, { poisoner: () => [1], monk: () => [1] });
    engine.dispatch({ type: "endDay" }); // 无处决入夜
    let mayorDecision = null;
    runNight(engine, {
      "mayor-redirect": (d) => {
        mayorDecision = d;
        return d.options.findIndex((o) => o.value.seat === 0); // 转移给厨师
      }
    }, {
      poisoner: () => [1],
      monk: () => [1],
      imp: () => [4] // 刀镇长
    });
    expect(mayorDecision).toBeTruthy();
    expect(engine.state.players[4].alive).toBe(true); // 镇长存活
    expect(engine.state.players[0].alive).toBe(false); // 厨师替死
  });

  it("恶魔自杀多爪牙时挂起传位裁量", () => {
    const engine = humanGame(7, 13, ["chef", "empath", "fortuneteller", "monk", "poisoner", "scarletwoman", "imp"]);
    runNight(engine, {}, { poisoner: () => [0], monk: () => [0] });
    engine.dispatch({ type: "endDay" });
    let starPass = null;
    runNight(engine, {
      "star-pass": (d) => {
        starPass = d;
        return d.options.findIndex((o) => o.value.seat === 4); // 传给投毒者而非猩红夫人
      }
    }, {
      poisoner: () => [0],
      monk: () => [0],
      imp: (s) => [s.players.find((p) => p.role === "imp").seat] // 自杀
    });
    expect(starPass).toBeTruthy();
    // 默认项应指向清醒的猩红夫人
    expect(starPass.options[starPass.defaultIndex].value.seat).toBe(5);
    expect(engine.state.players[4].role).toBe("imp");
    expect(engine.state.winner).toBe(null);
  });

  it("间谍提名圣女时挂起注册裁定", () => {
    const engine = humanGame(7, 17, ["chef", "virgin", "monk", "soldier", "mayor", "spy", "imp"]);
    runNight(engine);
    expect(engine.state.phase).toBe("day");
    const res = engine.dispatch({ type: "nominate", nominator: 5, nominee: 1 });
    expect(res.ok).toBe(true);
    const d = engine.state.pendingStorytellerDecision;
    expect(d.type).toBe("virgin-check");
    engine.dispatch({ type: "storytellerDecide", decisionId: d.id, choice: 0 }); // 注册为村民
    expect(engine.state.players[5].alive).toBe(false); // 间谍被处决
    expect(engine.state.phase).toBe("night");
  });

  it("真村民提名圣女无需裁定直接触发", () => {
    const engine = humanGame(7, 17, ["chef", "virgin", "monk", "soldier", "mayor", "spy", "imp"]);
    runNight(engine);
    engine.dispatch({ type: "nominate", nominator: 0, nominee: 1 });
    expect(engine.state.pendingStorytellerDecision).toBe(null);
    expect(engine.state.players[0].alive).toBe(false);
    expect(engine.state.phase).toBe("night");
  });

  it("杀手射击隐士时挂起注册裁定", () => {
    const engine = humanGame(7, 19, ["slayer", "chef", "monk", "soldier", "recluse", "poisoner", "imp"]);
    runNight(engine, {}, { poisoner: () => [1] });
    expect(engine.state.phase).toBe("day");
    const res = engine.dispatch({ type: "slayerShot", seat: 0, target: 4 });
    expect(res.ok).toBe(true);
    const d = engine.state.pendingStorytellerDecision;
    expect(d.type).toBe("slayer-shot");
    const dieIdx = d.options.findIndex((o) => o.value.dies);
    engine.dispatch({ type: "storytellerDecide", decisionId: d.id, choice: dieIdx });
    expect(engine.state.players[4].alive).toBe(false);
  });

  it("裁定记录只出现在说书人视图,玩家视图不可见", () => {
    const engine = humanGame(7, 7, ["washerwoman", "empath", "fortuneteller", "monk", "soldier", "poisoner", "imp"]);
    const d = engine.state.pendingStorytellerDecision;
    engine.dispatch({ type: "storytellerDecide", decisionId: d.id, choice: d.defaultIndex });
    const st = storytellerView(engine.state);
    const pv = playerView(engine.state, 0);
    expect(st.log.some((l) => l.type === "storyteller")).toBe(true);
    expect(pv.log.some((l) => l.type === "storyteller")).toBe(false);
    expect(pv.pendingStorytellerDecision).toBeUndefined();
  });

  it("human 模式序列化恢复后可继续裁定", () => {
    const engine = humanGame(7, 7, ["washerwoman", "empath", "fortuneteller", "monk", "soldier", "poisoner", "imp"]);
    const snapshot = engine.serialize();
    const restored = GameEngine.hydrate(snapshot);
    const d = restored.state.pendingStorytellerDecision;
    expect(d).toBeTruthy();
    const res = restored.dispatch({ type: "storytellerDecide", decisionId: d.id, choice: d.defaultIndex });
    expect(res.ok).toBe(true);
  });

  it("human 模式完整对局可分出胜负", () => {
    for (let seed = 400; seed < 403; seed++) {
      const engine = GameEngine.create(makePlayers(9), { seed, storytellerMode: "human" });
      const rng = createRng(seed * 11);
      let guard = 0;
      while (!engine.state.winner && guard++ < 800) {
        const s = engine.state;
        const d = s.pendingStorytellerDecision;
        if (d) {
          engine.dispatch({ type: "storytellerDecide", decisionId: d.id, choice: rng.int(d.options.length) });
          continue;
        }
        if (s.phase === "night") {
          const pa = s.pendingAction;
          if (!pa) break;
          const pool = s.players.filter((p) => (p.alive || pa.roleId === "ravenkeeper") && !(pa.notSelf && p.seat === pa.seat));
          const targets = [];
          for (let i = 0; i < pa.targets; i++) targets.push(rng.pick(pool).seat);
          engine.dispatch({ type: "nightAction", seat: pa.seat, targets });
        } else if (s.dayStage === "voting") {
          const seat = s.currentVote.order[s.currentVote.index];
          engine.dispatch({ type: "vote", seat, up: rng.chance(0.6) });
        } else if (s.phase === "day") {
          const alive = s.players.filter((p) => p.alive);
          const nominators = alive.filter((p) => !s.nominatorsToday.includes(p.seat));
          const nominees = alive.filter((p) => !s.nominatedToday.includes(p.seat));
          if (nominators.length && nominees.length && rng.chance(0.7)) {
            engine.dispatch({
              type: "nominate",
              nominator: rng.pick(nominators).seat,
              nominee: rng.pick(nominees).seat
            });
          } else {
            engine.dispatch({ type: "endDay" });
          }
        }
      }
      expect(engine.state.winner).toBeTruthy();
    }
  });
});
