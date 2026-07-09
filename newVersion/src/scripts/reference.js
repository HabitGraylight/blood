import { TEAM, TEAM_LABELS, resolveScript } from "./registry.js";

export const ROLE_TEAM_ORDER = [TEAM.TOWNSFOLK, TEAM.OUTSIDER, TEAM.MINION, TEAM.DEMON];

export function buildScriptRoleGroups(scriptOrId) {
  const script = resolveScript(scriptOrId);
  const roles = Object.values(script.roles || {});
  return ROLE_TEAM_ORDER.map((team) => ({
    team,
    label: TEAM_LABELS[team] || team,
    roles: roles.filter((role) => role.team === team)
  })).filter((group) => group.roles.length > 0);
}

export function roleTimingLabel(role) {
  if (!role.night) return "白天/被动";
  if (role.night === "first") return "首夜";
  if (role.night === "other") return "非首夜";
  if (role.night === "both") return "每夜";
  return role.night;
}
