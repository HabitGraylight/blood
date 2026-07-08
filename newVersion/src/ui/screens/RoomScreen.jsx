import React, { useEffect, useState } from "react";
import { Icon } from "../components/Icon.jsx";

/** 联机房间大厅:等待玩家、房主补 AI、开始游戏 */
export function RoomScreen({ session, onGameStart, onLeave }) {
  const [, force] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => session.subscribe(() => force((x) => x + 1)), [session]);

  useEffect(() => {
    if (session.status === "playing") onGameStart();
  }, [session.status, onGameStart]);

  const players = session.getLobbyPlayers();
  const isAI = session.storytellerMode === "ai";
  const storytellerIsHost = session.storytellerUid === session.uid;

  const start = async () => {
    const res = await session.startGame();
    if (!res.ok) setError(res.error);
    else onGameStart();
  };

  return (
    <div className="setup-screen panel">
      <h2>房间 <span className="room-code">{session.code}</span></h2>
      <p className="hint">剧本: {session.scriptId}. 需要 5-15 名玩家(可用 AI 补足)。</p>

      {/* 说书人信息栏 */}
      <div className="st-control-bar">
        <span className="lobby-avatar">
          {!isAI && session.storytellerPhotoURL
            ? <img className="lobby-avatar-img" src={session.storytellerPhotoURL} alt="说书人头像" />
            : <Icon name="storyteller" />}
        </span>
        <span className="lobby-name">
          {session.storytellerName || "说书人"}
          <em className="persona"> · {isAI ? "AI 说书人" : "说书人"}</em>
          {storytellerIsHost && session.isHost && <em className="persona"> (你)</em>}
        </span>
        {session.isHost && (
          <button
            className={`btn small ${isAI ? "primary" : "ghost"}`}
            onClick={() => isAI ? session.setStoryteller(session.uid, session.name) : session.setAIStoryteller()}
          >
            {isAI ? "切换人类说书人" : "切换 AI 说书人"}
          </button>
        )}
      </div>

      <ul className="lobby-list">
        {players.map((p) => (
          <li key={p.id} className="lobby-item">
            <span className={`lobby-avatar ${p.ai ? "ai" : ""}`}>
              {!p.ai && p.photoURL
                ? <img className="lobby-avatar-img" src={p.photoURL} alt={`${p.name} 的头像`} />
                : <Icon name={p.ai ? "ai" : "player"} />}
            </span>
            <span className="lobby-name">
              {p.name}
              {p.id === session.uid && " (你)"}
              {p.ai && <em className="persona"> · {p.persona}</em>}
            </span>
            {session.isHost && (
              <>
                {!p.ai && (
                  <button
                    className="link-btn st-btn"
                    onClick={() => session.setStoryteller(p.id, p.name, p.photoURL || "")}
                    title="将此玩家设为说书人"
                  >
                    设为说书人
                  </button>
                )}
                <button className="link-btn" onClick={() => session.removePlayer(p.id)}>移除</button>
              </>
            )}
          </li>
        ))}
      </ul>

      <p className="hint">
        当前玩家 {players.length} 人, 说书人 {isAI ? "AI" : "1"} 人
        {isAI && session.isHost && " (你会作为普通玩家参与游戏)"}
      </p>
      {error && <p className="error">{error}</p>}

      <div className="btn-row">
        <button className="btn ghost" onClick={onLeave}>离开房间</button>
        {session.isHost && (
          <>
            <button className="btn" onClick={() => session.addAI()}>+ 添加 AI 玩家</button>
            <button className="btn primary" disabled={players.length < 5} onClick={start}>
              开始游戏
            </button>
          </>
        )}
        {!session.isHost && <span className="hint">等待说书人开始……</span>}
      </div>
    </div>
  );
}