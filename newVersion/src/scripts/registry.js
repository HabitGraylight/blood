import { SCRIPT as TROUBLE_BREWING_DATA } from "./trouble-brewing.js";
import { TROUBLE_BREWING_BEHAVIORS } from "./trouble-brewing-behaviors.js";
import { TROUBLE_BREWING_REFERENCE } from "./trouble-brewing-reference.js";
import { TEAM, TEAM_LABELS, ALIGNMENT_LABELS } from "../core/constants.js";

export const DEFAULT_SCRIPT_ID = "trouble-brewing";

/**
 * 一个可运行的剧本 = 纯数据(角色表/夜间顺序/人数配置) + 行为模块(角色 hook) + 说明模块。
 * 新增剧本:数据文件 + 行为文件(契约见 trouble-brewing-behaviors.js 顶部说明) + reference 文件,
 * 在此组装注册即可,引擎与 UI 不需要改动。
 */
function attachReference(script, reference) {
  const roleNotes = reference?.roleNotes || {};
  const roles = Object.fromEntries(
    Object.entries(script.roles || {}).map(([roleId, role]) => [
      roleId,
      roleNotes[roleId] ? { ...role, clarify: roleNotes[roleId] } : role
    ])
  );
  return {
    ...script,
    roles,
    rulesBrief: reference?.rulesBrief || script.rulesBrief,
    reference
  };
}

export const TROUBLE_BREWING = {
  ...attachReference(TROUBLE_BREWING_DATA, TROUBLE_BREWING_REFERENCE),
  behaviors: TROUBLE_BREWING_BEHAVIORS
};

export const SCRIPT_REGISTRY = {
  [TROUBLE_BREWING.id]: TROUBLE_BREWING
};

export const AVAILABLE_SCRIPTS = Object.values(SCRIPT_REGISTRY);

export function getScript(scriptId = DEFAULT_SCRIPT_ID) {
  return SCRIPT_REGISTRY[scriptId] || SCRIPT_REGISTRY[DEFAULT_SCRIPT_ID];
}

export function resolveScript(scriptOrId) {
  return scriptOrId && scriptOrId.roles ? scriptOrId : getScript(scriptOrId);
}

export function rolesByTeam(scriptOrId, team) {
  const script = resolveScript(scriptOrId);
  return Object.values(script.roles).filter((r) => r.team === team);
}

export function roleName(scriptOrId, roleId) {
  const script = resolveScript(scriptOrId);
  return script.roles[roleId] ? script.roles[roleId].name : roleId;
}

export function getSetupForScript(scriptId, playerCount) {
  const script = getScript(scriptId);
  return script.setupTable[playerCount] || null;
}

export { TEAM, TEAM_LABELS, ALIGNMENT_LABELS };
