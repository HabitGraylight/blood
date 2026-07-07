import React from "react";
import { ROLES, TEAM_LABELS } from "../../core/data/roles.js";

/**
 * 城镇广场:玩家围坐一圈。
 * 座位按圆形布局;死亡玩家盖裹尸布;有遗书票的死者显示投票标记。
 */
export function TownSquare({ view, selectable, picked, onSeatClick }) {
  const n = view.seats.length;
  const cv = view.currentVote;

  return (
    <div className="town-square">
      <div className="square-center">
        {view.onBlock && view.onBlock.seat != null ? (
          <div className="block-notice">
            ⚖️ {view.seats[view.onBlock.seat].name}
            <small>{view.onBlock.votes} 票 · 待处决</small>
          </div>
        ) : (
          <div className="square-clock">🕰</div>
        )}
      </div>

      {view.seats.map((s) => {
        const angle = ((2 * Math.PI) / n) * s.seat - Math.PI / 2;
        const x = 50 + 42 * Math.cos(angle);
        const y = 50 + 42 * Math.sin(angle);
        const isMe = s.seat === view.seat;
        const isSelectable = selectable.has(s.seat);
        const isPicked = picked.includes(s.seat);
        const voteMark = cv && cv.votes[s.seat] === true;
        const isVoting = cv && cv.order[cv.index] === s.seat;
        const isNominee = cv && cv.nominee === s.seat;
        const role = s.revealedRole ? ROLES[s.revealedRole] : null;

        return (
          <div
            key={s.seat}
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
              onClick={() => onSeatClick(s.seat)}
              disabled={!isSelectable}
            >
              <span className="seat-token">
                {role ? role.symbol : s.alive ? (s.isHuman ? "🧑" : "🤖") : "💀"}
              </span>
              <span className="seat-name">
                {s.name}
                {isMe && <em>(你)</em>}
              </span>
              {role && (
                <span className={`seat-role team-${role.team}`}>
                  {role.name} · {TEAM_LABELS[role.team]}
                </span>
              )}
              {!s.alive && s.ghostVote && <span className="ghost-vote" title="遗书票">🪶</span>}
              {voteMark && <span className="hand" title="举手">✋</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
