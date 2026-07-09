import React, { useMemo } from "react";
import { getScript } from "../../scripts/registry.js";
import { buildScriptRoleGroups, roleTimingLabel } from "../../scripts/reference.js";
import { RoleIcon } from "./RoleIcon.jsx";
import { Icon } from "./Icon.jsx";

/**
 * 板子角色一览弹窗。点击 header 中的"查看板子"按钮后弹出,
 * 按阵营分组列出当前剧本的全部角色及其能力。 */
export function ScriptRoleModal({ scriptId, script: scriptProp, onClose }) {
  const script = scriptProp || getScript(scriptId);
  const groups = useMemo(() => buildScriptRoleGroups(script), [script]);
  const roleCount = groups.reduce((sum, group) => sum + group.roles.length, 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal script-role-modal panel" onClick={(e) => e.stopPropagation()}>
        <header className="script-role-modal-head">
          <h2>
            <Icon name="log" size={20} /> {script.name}
          </h2>
          <div className="script-role-modal-sub">
            <small>{script.englishName} · {roleCount} 个角色</small>
          </div>
          <button className="script-role-modal-close" aria-label="关闭" onClick={onClose}>×</button>
        </header>

        <div className="script-role-modal-body">
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
                        <small>{roleTimingLabel(role, script)}{role.input ? ` · 选 ${role.targets || 1}` : ""}</small>
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
      </div>
    </div>
  );
}
