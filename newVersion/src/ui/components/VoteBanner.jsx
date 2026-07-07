import React from "react";

/** 投票横幅:显示被提名者、投票进度;轮到自己时给出举手按钮 */
export function VoteBanner({ view, onVote }) {
  const cv = view.currentVote;
  const nominee = view.seats[cv.nominee];
  const nominator = view.seats[cv.nominator];
  const currentVoter = view.seats[cv.order[cv.index]];
  const yesCount = Object.values(cv.votes).filter(Boolean).length;
  const aliveCount = view.seats.filter((s) => s.alive).length;
  const threshold = Math.ceil(aliveCount / 2);

  return (
    <div className="vote-banner">
      <div className="vote-info">
        <strong>{nominator.name}</strong> 提名 <strong className="nominee-name">{nominee.name}</strong>
        <span className="vote-progress">
          {yesCount} / 需 {threshold} 票 · 第 {cv.index + 1}/{cv.order.length} 位表决
        </span>
      </div>
      {cv.isMyTurn ? (
        <div className="vote-actions">
          <span>轮到你了!</span>
          {!view.you.alive && <em className="hint">(将消耗遗书票)</em>}
          <button className="btn vote-yes" onClick={() => onVote(true)}>✋ 举手赞成</button>
          <button className="btn vote-no" onClick={() => onVote(false)}>✖ 不举手</button>
        </div>
      ) : (
        <span className="vote-waiting">等待 {currentVoter ? currentVoter.name : ""} 表决……</span>
      )}
    </div>
  );
}
