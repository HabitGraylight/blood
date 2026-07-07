import React from "react";
import { ROLES, roleName } from "../../core/data/roles.js";
import { RoleIcon } from "./RoleIcon.jsx";
import { Icon } from "./Icon.jsx";

/** 身份卡 + 私密信息记录 */
export function RoleCard({ view }) {
  const you = view.you;
  const role = ROLES[you.role];

  return (
    <div className="role-card-wrap">
      <div className={`role-card team-${you.team}`}>
        <div className="role-symbol"><RoleIcon roleId={you.role} scriptId={view.scriptId} size={64} /></div>
        <div className="role-meta">
          <h3>{you.roleName}</h3>
          <span className="role-team">{you.teamLabel} · {you.alignmentLabel}阵营</span>
        </div>
        <p className="role-ability">{you.ability}</p>
        {!you.alive && (
          <p className="role-dead">
            <Icon name="dead" /> 你已死亡。{you.ghostVote ? "你还有一次遗书票,可继续发言。" : "遗书票已用完,但仍可发言。"}
          </p>
        )}
        {you.evilInfo && (
          <div className="evil-info">
            <strong>邪恶阵营情报</strong>
            <p>恶魔:{view.seats[you.evilInfo.demonSeat].name}</p>
            {you.evilInfo.minionSeats.length > 0 && (
              <p>爪牙:{you.evilInfo.minionSeats.map((s) => view.seats[s].name).join("、")}</p>
            )}
            {you.evilInfo.bluffs.length > 0 && (
              <p>可伪装:{you.evilInfo.bluffs.map(roleName).join("、")}</p>
            )}
          </div>
        )}
        {you.master != null && (
          <p className="hint">你的主人:{view.seats[you.master].name}</p>
        )}
      </div>

      <div className="private-log">
        <h4>🔒 你的私密信息</h4>
        {you.privateLog.length === 0 && <p className="hint">暂无。夜晚的信息会出现在这里。</p>}
        <ul>
          {you.privateLog.map((l, i) => (
            <li key={i}>
              <span className="log-night">第{l.night}夜</span>
              <span className="log-text">{l.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
