import React, { useState } from "react";
import { FirebaseHostSession, FirebaseGuestSession } from "../../session/firebaseSession.js";
import { AVAILABLE_SCRIPTS, DEFAULT_SCRIPT_ID } from "../../scripts/registry.js";
import { ScriptSelect } from "../components/ScriptSelect.jsx";

export function MultiLobbyScreen({ onEnterRoom, onBack, user }) {
  const defaultName = user?.displayName || (user?.email ? user.email.split("@")[0] : "");
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState("");
  const [scriptId, setScriptId] = useState(DEFAULT_SCRIPT_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const script = AVAILABLE_SCRIPTS.find((s) => s.id === scriptId) || AVAILABLE_SCRIPTS[0];

  const playerName = () => name.trim() || defaultName || "玩家";

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
      const s = await FirebaseHostSession.create(playerName(), scriptId);
      onEnterRoom(s);
    });

  const join = () =>
    withBusy(async () => {
      if (!code.trim()) throw new Error("请输入房间码");
      const s = await FirebaseGuestSession.join(code, playerName());
      onEnterRoom(s);
    });

  return (
    <div className="setup-screen panel">
      <h2>多人联机</h2>
      <p className="hint">当前登录账号会提供稳定 uid。创建或加入房间后,刷新页面仍会回到同一身份。</p>
      <label className="field">
        <span>游戏内显示名</span>
        <input value={name} maxLength={12} placeholder={defaultName || "输入昵称"}
          onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="lobby-actions">
        <div className="lobby-block">
          <h3>创建房间</h3>
          <div className="field compact-field">
            <span>剧本</span>
            <ScriptSelect scripts={AVAILABLE_SCRIPTS} value={scriptId} onChange={setScriptId} />
          </div>
          <p className="hint">{script.summary}</p>
          <p className="hint">你将成为独立说书人,不占玩家座位。请保持页面开启。</p>
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


