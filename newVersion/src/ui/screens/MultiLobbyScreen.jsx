import React, { useState } from "react";
import { FirebaseHostSession, FirebaseGuestSession } from "../../session/firebaseSession.js";

export function MultiLobbyScreen({ onEnterRoom, onBack }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const withBusy = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    withBusy(async () => {
      const s = await FirebaseHostSession.create(name.trim() || "房主");
      onEnterRoom(s);
    });

  const join = () =>
    withBusy(async () => {
      if (!code.trim()) throw new Error("请输入房间码");
      const s = await FirebaseGuestSession.join(code, name.trim() || "玩家");
      onEnterRoom(s);
    });

  return (
    <div className="setup-screen panel">
      <h2>多人联机</h2>
      <label className="field">
        <span>你的名字</span>
        <input value={name} maxLength={8} placeholder="输入昵称"
          onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="lobby-actions">
        <div className="lobby-block">
          <h3>创建房间</h3>
          <p className="hint">你将成为房主。开局后你的浏览器负责主持游戏,请保持页面开启。</p>
          <button className="btn primary" disabled={busy} onClick={create}>创建房间</button>
        </div>
        <div className="lobby-block">
          <h3>加入房间</h3>
          <input
            className="code-input" value={code} maxLength={4} placeholder="房间码"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="btn primary" disabled={busy} onClick={join}>加入</button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="btn-row">
        <button className="btn ghost" onClick={onBack}>返回</button>
      </div>
    </div>
  );
}
