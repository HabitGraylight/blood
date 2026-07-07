import React, { useState } from "react";
import { getScript, TEAM_LABELS, ALIGNMENT_LABELS } from "../../scripts/registry.js";
import { RoleIcon } from "./RoleIcon.jsx";
import { Icon } from "./Icon.jsx";

/** 终局结算:胜负 + 全员身份公开 */
export function EndOverlay({ view, onLeave }) {
  const [minimized, setMinimized] = useState(false);
  if (minimized) {
    return (
      <button className="btn end-restore" onClick={() => setMinimized(false)}>
        查看终局结算
      </button>
    );
  }

  const good = view.winner === "good";
  const script = getScript(view.scriptId);
  const roles = script.roles || {};
  return (
    <div className="end-overlay">
      <div className={`end-card ${good ? "good-win" : "evil-win"}`}>
        <h2>{good ? "🌅 善良阵营获胜" : "🩸 邪恶阵营获胜"}</h2>
        <p className="end-reason">{view.winReason}</p>
        <ul className="reveal-list">
          {view.seats.map((s) => {
            const role = roles[s.revealedRole];
            return (
              <li key={s.seat} className={`reveal-item align-${s.revealedAlignment}`}>
                <span className="reveal-symbol">{role ? <RoleIcon roleId={s.revealedRole} scriptId={view.scriptId} size={34} /> : "?"}</span>
                <span className="reveal-name">{s.name}</span>
                <span className="reveal-role">
                  {role ? role.name : "?"} · {role ? TEAM_LABELS[role.team] : ""}
                  {s.revealedAlignment ? ` · ${ALIGNMENT_LABELS[s.revealedAlignment]}` : ""}
                </span>
                {!s.alive && <span className="reveal-dead"><Icon name="dead" size={16} /></span>}
              </li>
            );
          })}
        </ul>
        <div className="btn-row">
          <button className="btn ghost" onClick={() => setMinimized(true)}>回顾对局</button>
          <button className="btn primary" onClick={onLeave}>返回大厅</button>
        </div>
      </div>
    </div>
  );
}
