import React, { useState } from "react";
import { ROLES, TEAM_LABELS, ALIGNMENT_LABELS } from "../../core/data/roles.js";

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
  return (
    <div className="end-overlay">
      <div className={`end-card ${good ? "good-win" : "evil-win"}`}>
        <h2>{good ? "🌅 善良阵营获胜" : "🩸 邪恶阵营获胜"}</h2>
        <p className="end-reason">{view.winReason}</p>
        <ul className="reveal-list">
          {view.seats.map((s) => {
            const role = ROLES[s.revealedRole];
            return (
              <li key={s.seat} className={`reveal-item align-${s.revealedAlignment}`}>
                <span className="reveal-symbol">{role ? role.symbol : "?"}</span>
                <span className="reveal-name">{s.name}</span>
                <span className="reveal-role">
                  {role ? role.name : "?"} · {role ? TEAM_LABELS[role.team] : ""}
                  {s.revealedAlignment ? ` · ${ALIGNMENT_LABELS[s.revealedAlignment]}` : ""}
                </span>
                {!s.alive && <span className="reveal-dead">☠</span>}
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
