import { describe, expect, it } from "vitest";
import { TEAM, getScript } from "../src/scripts/registry.js";
import { buildScriptRoleGroups, roleTimingLabel } from "../src/scripts/reference.js";

describe("剧本板子引用数据", () => {
  it("按阵营输出完整角色清单", () => {
    const script = getScript("trouble-brewing");
    const groups = buildScriptRoleGroups(script);
    const roleIds = groups.flatMap((group) => group.roles.map((role) => role.id));

    expect(groups.map((group) => group.team)).toEqual([
      TEAM.TOWNSFOLK,
      TEAM.OUTSIDER,
      TEAM.MINION,
      TEAM.DEMON
    ]);
    expect(roleIds).toHaveLength(Object.keys(script.roles).length);
    expect(new Set(roleIds).size).toBe(roleIds.length);
  });

  it("把夜晚触发时机转换为玩家可读标签", () => {
    const script = getScript("trouble-brewing");
    expect(roleTimingLabel({ night: "first" }, script)).toBe("首夜");
    expect(roleTimingLabel({ night: "other" }, script)).toBe("非首夜");
    expect(roleTimingLabel({ night: "both" }, script)).toBe("每夜");
    expect(roleTimingLabel({ night: null }, script)).toBe("白天/被动");
  });

  it("角色说明来自独立 reference 模块并被 registry 组装到剧本入口", () => {
    const script = getScript("trouble-brewing");
    expect(script.rulesBrief).toBe(script.reference.rulesBrief);
    expect(script.reference.roleNotes.fortuneteller).toContain("红鲱鱼");
    expect(script.roles.fortuneteller.clarify).toBe(script.reference.roleNotes.fortuneteller);
  });
});
