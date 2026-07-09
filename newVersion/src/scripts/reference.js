import { TEAM, TEAM_LABELS, resolveScript } from "./registry.js";

export const ROLE_TEAM_ORDER = [TEAM.TOWNSFOLK, TEAM.OUTSIDER, TEAM.MINION, TEAM.DEMON];
export const DEFAULT_TIMING_LABELS = {
  none: "白天/被动",
  first: "首夜",
  other: "非首夜",
  both: "每夜"
};

export function buildScriptRoleGroups(scriptOrId) {
  const script = resolveScript(scriptOrId);
  const roles = Object.values(script.roles || {});
  return ROLE_TEAM_ORDER.map((team) => ({
    team,
    label: TEAM_LABELS[team] || team,
    roles: roles.filter((role) => role.team === team)
  })).filter((group) => group.roles.length > 0);
}

export function roleTimingLabel(role, scriptOrId) {
  const script = scriptOrId ? resolveScript(scriptOrId) : null;
  const labels = script?.reference?.timingLabels || DEFAULT_TIMING_LABELS;
  if (!role.night) return labels.none || DEFAULT_TIMING_LABELS.none;
  if (labels[role.night]) return labels[role.night];
  return role.night;
}
