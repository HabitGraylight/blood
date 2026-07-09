import React, { useMemo, useState } from "react";
import { getScript } from "../../scripts/registry.js";
import { buildScriptRoleGroups, roleTimingLabel } from "../../scripts/reference.js";
import { RoleIcon } from "./RoleIcon.jsx";

export function ScriptRoleReference({ scriptId, script: scriptProp, defaultOpen = false }) {
  const script = scriptProp || getScript(scriptId);
  const [open, setOpen] = useState(defaultOpen);
  const groups = useMemo(() => buildScriptRoleGroups(script), [script]);
  const roleCount = groups.reduce((sum, group) => sum + group.roles.length, 0);

  return (
    <section className={`script-reference ${open ? "open" : ""}`}>
      <button
        type="button"
        className="script-reference-toggle"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <span>
          <strong>{script.name}</strong>
          <small>{script.englishName} · {roleCount} 个角色</small>
        </span>
        <b>{open ? "收起板子" : "查看板子"}</b>
      </button>

      {open && (
        <div className="script-reference-body">
          {groups.map((group) => (
            <div className={`script-team-block team-${group.team}`} key={group.team}>
              <h4>
                {group.label}
                <em>{group.roles.length}</em>
              </h4>
              <div className="script-role-grid">
                {group.roles.map((role) => (
                  <article className="script-role-item" key={role.id}>
                    <RoleIcon roleId={role.id} scriptId={script.id} size={40} />
                    <div>
                      <header>
                        <strong>{role.name}</strong>
                        <small>{roleTimingLabel(role)}{role.input ? ` · 选 ${role.targets || 1}` : ""}</small>
                      </header>
                      <p>{role.ability}</p>
                      {role.clarify && <small className="script-role-note">{role.clarify}</small>}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
