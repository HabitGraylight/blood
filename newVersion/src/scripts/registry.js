import { SCRIPT as TROUBLE_BREWING_DATA } from "./trouble-brewing.js";
import { TROUBLE_BREWING_BEHAVIORS } from "./trouble-brewing-behaviors.js";
import { TROUBLE_BREWING_REFERENCE } from "./trouble-brewing-reference.js";
import { TEAM, TEAM_LABELS, ALIGNMENT_LABELS } from "../core/constants.js";

export const DEFAULT_SCRIPT_ID = "trouble-brewing";

/**
 * 一个可运行的剧本 = 三个模块,全部放在 scripts/ 目录,核心代码零改动:
 *
 * 1. 数据文件(纯数据,如 trouble-brewing.js):
 *    - roles: 角色定义(team/night/input/targets/ability/misregister/
 *      setupModifier/aiNightPolicy/hidden/noAbility ...)
 *    - nightOrder / setupTable / minPlayers / maxPlayers
 *    - dayActions: 白天主动能力(actionType/targetPolicy/announceTemplate/aiGuide ...),
 *      会话层与 AI 驱动器完全按此配置放行与调度
 *    - foreignRoleWords / rulesProfile / iconSet
 * 2. 行为文件(角色 hook,如 trouble-brewing-behaviors.js,契约见其顶部说明):
 *    roles hook、finalizeSetup、setupSteps、actions、resumeHandlers、
 *    buildNightInfoOptions、可选 checkWin 覆盖
 * 3. reference 文件(玩家/AI 说明,如 trouble-brewing-reference.js):
 *    rulesBrief、roleNotes、timingLabels、endgameHints
 *
 * 组装并 registerScript() 即可;可选为角色提供 prompts/roles/{scriptId}/{roleId}.md
 * 提示词(缺失时回退到通用 default.md)。
 */
export function assembleScript(data, reference, behaviors) {
  const roleNotes = reference?.roleNotes || {};
  const roles = Object.fromEntries(
    Object.entries(data.roles || {}).map(([roleId, role]) => [
      roleId,
      roleNotes[roleId] ? { ...role, clarify: roleNotes[roleId] } : role
    ])
  );
  return {
    ...data,
    roles,
    rulesBrief: reference?.rulesBrief || data.rulesBrief,
    reference,
    behaviors
  };
}

export const SCRIPT_REGISTRY = {};
export const AVAILABLE_SCRIPTS = [];

export function registerScript(script) {
  if (!SCRIPT_REGISTRY[script.id]) AVAILABLE_SCRIPTS.push(script);
  SCRIPT_REGISTRY[script.id] = script;
  return script;
}

export const TROUBLE_BREWING = registerScript(
  assembleScript(TROUBLE_BREWING_DATA, TROUBLE_BREWING_REFERENCE, TROUBLE_BREWING_BEHAVIORS)
);

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
