import { describe, it, expect } from "vitest";
import { GameEngine } from "../src/core/engine.js";
import { drawRoles } from "../src/core/setup.js";
import { resolveVoteResult, checkWin } from "../src/core/rules.js";
import { createRng } from "../src/core/rng.js";
import { ROLES, TEAM, SETUP_TABLE } from "../src/core/data/roles.js";

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

  it("序列化后可恢复继续游戏", () => {
    const engine = GameEngine.create(makePlayers(7), { seed: 31, fixedRoles: ROLES_7 });
    autoNight(engine);
    const snapshot = engine.serialize();
    const restored = GameEngine.hydrate(snapshot);
    const res = restored.dispatch({ type: "nominate", nominator: 0, nominee: 5 });
    expect(res.ok).toBe(true);
    expect(restored.state.dayStage).toBe("voting");
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
