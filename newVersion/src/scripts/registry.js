import { SCRIPT as TROUBLE_BREWING, TEAM, TEAM_LABELS, ALIGNMENT_LABELS } from "./trouble-brewing.js";

export const DEFAULT_SCRIPT_ID = "trouble-brewing";

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

export { TROUBLE_BREWING, TEAM, TEAM_LABELS, ALIGNMENT_LABELS };