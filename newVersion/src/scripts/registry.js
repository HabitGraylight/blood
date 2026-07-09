import { SCRIPT as TROUBLE_BREWING_DATA, TEAM, TEAM_LABELS, ALIGNMENT_LABELS } from "./trouble-brewing.js";
import { TROUBLE_BREWING_BEHAVIORS } from "./trouble-brewing-behaviors.js";

export const DEFAULT_SCRIPT_ID = "trouble-brewing";

/**
 * 一个可运行的剧本 = 纯数据(角色表/夜间顺序/人数配置) + 行为模块(角色 hook)。
 * 新增剧本:数据文件 + 行为文件(契约见 trouble-brewing-behaviors.js 顶部说明),
 * 在此组装注册即可,引擎与 UI 不需要改动。
 */
export const TROUBLE_BREWING = { ...TROUBLE_BREWING_DATA, behaviors: TROUBLE_BREWING_BEHAVIORS };

export const SCRIPT_REGISTRY = {
  [TROUBLE_BREWING.id]: TROUBLE_BREWING
};

export const AVAILABLE_SCRIPTS = Object.values(SCRIPT_REGISTRY);

export function getScript(scriptId = DEFAULT_SCRIPT_ID) {
  return SCRIPT_REGISTRY[scriptId] || SCRIPT_REGISTRY[DEFAULT_SCRIPT_ID];
}

export function getSetupForScript(scriptId, playerCount) {
  const script = getScript(scriptId);
  return script.setupTable[playerCount] || null;
}

export { TEAM, TEAM_LABELS, ALIGNMENT_LABELS };
