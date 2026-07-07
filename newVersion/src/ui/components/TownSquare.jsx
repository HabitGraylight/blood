import React from "react";
import { getScript, TEAM_LABELS } from "../../scripts/registry.js";
import { Icon } from "./Icon.jsx";
import { RoleIcon } from "./RoleIcon.jsx";

export function TownSquare({ view, selectable, picked, onSeatClick }) {
  const seats = Array.isArray(view.seats) ? view.seats.filter(Boolean) : [];
  const n = Math.max(1, seats.length);
  const cv = view.currentVote || null;
  const votes = cv?.votes && typeof cv.votes === "object" ? cv.votes : {};
  const order = Array.isArray(cv?.order) ? cv.order : [];
  const selected = selectable instanceof Set ? selectable : new Set();
  const pickedSeats = Array.isArray(picked) ? picked : [];
  const onBlockSeat = view.onBlock?.seat;
  const onBlockPlayer = onBlockSeat != null ? seats.find((s) => s.seat === onBlockSeat) : null;
  const script = getScript(view.scriptId);
  const roles = script.roles || {};

  return (
    <div className="town-square">
      <div className="square-center">
        {onBlockPlayer ? (
          <div className="block-notice">
            {onBlockPlayer.name}
            <small>{view.onBlock.votes} 票 · 待处决</small>
          </div>
        ) : (
          <div className="square-clock"><Icon name="room" size={42} /></div>
        )}
      </div>

      {seats.map((s, idx) => {
        const logicalSeat = s.seat ?? idx;
        const angle = ((2 * Math.PI) / n) * idx - Math.PI / 2;
        const x = 50 + 42 * Math.cos(angle);
        const y = 50 + 42 * Math.sin(angle);
        const isMe = logicalSeat === view.seat;
        const isSelectable = selected.has(logicalSeat);
        const isPicked = pickedSeats.includes(logicalSeat);
        const voteMark = votes[logicalSeat] === true;
        const isVoting = cv && order[cv.index || 0] === logicalSeat;
        const isNominee = cv && cv.nominee === logicalSeat;
        const role = s.revealedRole ? roles[s.revealedRole] : null;

        return (
          <div
            key={logicalSeat}
            className="seat-slot"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <button
              className={[
                "seat",
                s.alive ? "" : "dead",
                isMe ? "me" : "",
                isSelectable ? "selectable" : "",
                isPicked ? "picked" : "",
                isVoting ? "voting-now" : "",
                isNominee ? "nominee" : ""
              ].join(" ")}
              onClick={() => onSeatClick(logicalSeat)}
              disabled={!isSelectable}
            >
              <span className="seat-token">
                {role ? <RoleIcon roleId={s.revealedRole} scriptId={view.scriptId} size={50} /> : <Icon name={s.alive ? (s.isHuman ? "player" : "ai") : "dead"} size={28} />}
              </span>
              <span className="seat-name">
                {s.name || `玩家${idx + 1}`}
                {isMe && <em>(你)</em>}
              </span>
              {role && (
                <span className={`seat-role team-${role.team}`}>
                  {role.name} · {TEAM_LABELS[role.team]}
                </span>
              )}
              {!s.alive && s.ghostVote && <span className="ghost-vote" title="遗书票"><Icon name="ghostVote" size={16} /></span>}
              {voteMark && <span className="hand" title="举手"><Icon name="hand" size={18} /></span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
