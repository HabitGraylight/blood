import React from "react";
import { getScript } from "../../scripts/registry.js";
import { RoleIcon } from "./RoleIcon.jsx";
import { Icon } from "./Icon.jsx";

export function RoleCard({ view }) {
  const you = view.you || {};
  const privateLog = Array.isArray(you.privateLog) ? you.privateLog : [];
  const evilInfo = you.evilInfo || null;
  const minionSeats = Array.isArray(evilInfo?.minionSeats) ? evilInfo.minionSeats : [];
  const bluffs = Array.isArray(evilInfo?.bluffs) ? evilInfo.bluffs : [];
  const script = getScript(view.scriptId);
  const roles = script.roles || {};
  const role = roles[you.role] || {};
  const roleName = (roleId) => roles[roleId]?.name || roleId;

  return (
    <div className="role-card-wrap">
      <div className={`role-card team-${you.team || role.team || "townsfolk"}`}>
        <div className="role-symbol"><RoleIcon roleId={you.role} scriptId={view.scriptId} size={64} /></div>
        <div className="role-meta">
          <h3>{you.roleName || role.name || "未知身份"}</h3>
          <span className="role-team">{you.teamLabel || "未知"} · {you.alignmentLabel || "未知"}阵营</span>
        </div>
        <p className="role-ability">{you.ability || role.ability || "等待房主同步身份信息。"}</p>
        {you.alive === false && (
          <p className="role-dead">
            <Icon name="dead" /> 你已死亡。{you.ghostVote ? "你还有一次遗书票,可继续发言。" : "遗书票已用完,但仍可发言。"}
          </p>
        )}
        {evilInfo && (
          <div className="evil-info">
            <strong>邪恶阵营情报</strong>
            {view.seats?.[evilInfo.demonSeat] && <p>恶魔:{view.seats[evilInfo.demonSeat].name}</p>}
            {minionSeats.length > 0 && (
              <p>爪牙:{minionSeats.map((s) => view.seats?.[s]?.name || `${s}号`).join("、")}</p>
            )}
            {bluffs.length > 0 && (
              <p>可伪装:{bluffs.map(roleName).join("、")}</p>
            )}
          </div>
        )}
        {you.master != null && view.seats?.[you.master] && (
          <p className="hint">你的主人:{view.seats[you.master].name}</p>
        )}
      </div>

      <div className="private-log">
        <h4><Icon name="log" /> 你的私密信息</h4>
        {privateLog.length === 0 && <p className="hint">暂无。夜晚的信息会出现在这里。</p>}
        <ul>
          {privateLog.map((l, i) => (
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
