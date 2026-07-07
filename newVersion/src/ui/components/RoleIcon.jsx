import React from "react";
import { getScript } from "../../scripts/registry.js";

export function RoleIcon({ roleId, scriptId = "trouble-brewing", size = 48, className = "" }) {
  const script = getScript(scriptId);
  const role = script.roles[roleId];
  const label = role ? role.name.slice(0, 1) : "?";
  const team = role ? role.team : "unknown";
  return (
    <svg className={`role-svg role-svg-${team} ${className}`} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={role ? role.name : "未知角色"}>
      <defs>
        <radialGradient id={`role-grad-${team}`} cx="35%" cy="25%" r="70%">
          <stop offset="0%" stopColor="#6f5a8d" />
          <stop offset="70%" stopColor="#241b38" />
          <stop offset="100%" stopColor="#120e1c" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="29" fill={`url(#role-grad-${team})`} stroke="currentColor" strokeWidth="2" />
      <path d="M32 8l4 10 11 1-8 7 2 11-9-6-9 6 2-11-8-7 11-1 4-10Z" fill="none" stroke="rgba(232,198,132,.55)" strokeWidth="1.2" />
      <text x="32" y="40" textAnchor="middle" fontSize="24" fontWeight="700" fill="#e8c684" fontFamily="serif">{label}</text>
    </svg>
  );
}