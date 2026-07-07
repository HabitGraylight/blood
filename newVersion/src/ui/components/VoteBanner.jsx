import React from "react";
import { Icon } from "./Icon.jsx";

export function VoteBanner({ view, onVote }) {
  const cv = view.currentVote || {};
  const seats = Array.isArray(view.seats) ? view.seats : [];
  const order = Array.isArray(cv.order) ? cv.order : [];
  const votes = cv.votes && typeof cv.votes === "object" ? cv.votes : {};
  const nominee = seats[cv.nominee] || { name: "未知玩家" };
  const nominator = seats[cv.nominator] || { name: "未知玩家" };
  const currentSeat = order[cv.index || 0];
  const currentVoter = seats[currentSeat] || null;
  const yesCount = Object.values(votes).filter(Boolean).length;
  const aliveCount = seats.filter((s) => s && s.alive).length;
  const threshold = Math.ceil(Math.max(1, aliveCount) / 2);

  return (
    <div className="vote-banner">
      <div className="vote-info">
        <strong>{nominator.name}</strong> 提名 <strong className="nominee-name">{nominee.name}</strong>
        <span className="vote-progress">
          {yesCount} / 需 {threshold} 票 · 第 {(cv.index || 0) + 1}/{Math.max(1, order.length)} 位表决
        </span>
      </div>
      {cv.isMyTurn ? (
        <div className="vote-actions">
          <span>轮到你了!</span>
          {view.you?.alive === false && <em className="hint">(将消耗遗书票)</em>}
          <button className="btn vote-yes" onClick={() => onVote(true)}><Icon name="hand" /> 举手赞成</button>
          <button className="btn vote-no" onClick={() => onVote(false)}><Icon name="voteNo" /> 不举手</button>
        </div>
      ) : (
        <span className="vote-waiting">等待 {currentVoter ? currentVoter.name : "下一位玩家"} 表决...</span>
      )}
    </div>
  );
}
