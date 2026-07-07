import React, { useEffect, useState } from "react";

/** 联机房间大厅:等待玩家、房主补 AI、开始游戏 */
export function RoomScreen({ session, onGameStart, onLeave }) {
  const [, force] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => session.subscribe(() => force((x) => x + 1)), [session]);

  // 游戏开始:访客通过 status 感知;房主在点击开始时切换
  useEffect(() => {
    if (session.status === "playing") onGameStart();
  }, [session.status, onGameStart]);

  const players = session.getLobbyPlayers();

  const start = async () => {
    const res = await session.startGame();
    if (!res.ok) setError(res.error);
    else onGameStart();
  };

  return (
    <div className="setup-screen panel">
      <h2>房间 <span className="room-code">{session.code}</span></h2>
      <p className="hint">把房间码告诉朋友,等人齐后开始。需要 5-15 名玩家(可用 AI 补足)。</p>

      <ul className="lobby-list">
        {players.map((p) => (
          <li key={p.id} className="lobby-item">
            <span className={`lobby-avatar ${p.ai ? "ai" : ""}`}>{p.ai ? "🤖" : "🧑"}</span>
            <span className="lobby-name">
              {p.name}
              {p.id === session.uid && " (你)"}
              {p.ai && <em className="persona"> · {p.persona}</em>}
            </span>
            {session.isHost && p.id !== session.uid && (
              <button className="link-btn" onClick={() => session.removePlayer(p.id)}>移除</button>
            )}
          </li>
        ))}
      </ul>

      <p className="hint">当前 {players.length} 人</p>
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
        {!session.isHost && <span className="hint">等待房主开始……</span>}
      </div>
    </div>
  );
}
