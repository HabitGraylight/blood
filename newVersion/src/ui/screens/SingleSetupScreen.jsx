import React, { useState } from "react";
import { AVAILABLE_SCRIPTS, getSetupForScript, DEFAULT_SCRIPT_ID } from "../../scripts/registry.js";

export function SingleSetupScreen({ onStart, onBack }) {
  const [name, setName] = useState("我");
  const [count, setCount] = useState(8);
  const [scriptId, setScriptId] = useState(DEFAULT_SCRIPT_ID);
  const script = AVAILABLE_SCRIPTS.find((s) => s.id === scriptId) || AVAILABLE_SCRIPTS[0];
  const setup = getSetupForScript(scriptId, count);

  return (
    <div className="setup-screen panel">
      <h2>单人对局设置</h2>
      <label className="field">
        <span>剧本</span>
        <select value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
          {AVAILABLE_SCRIPTS.map((s) => (
            <option key={s.id} value={s.id}>{s.name} · {s.englishName}</option>
          ))}
        </select>
      </label>
      <p className="hint">{script.summary}</p>
      <label className="field">
        <span>你的名字</span>
        <input value={name} maxLength={8} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>玩家总数(含你): {count} 人</span>
        <input
          type="range" min={script.minPlayers} max={script.maxPlayers} value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </label>
      {setup && (
        <div className="setup-preview">
          <span className="chip chip-townsfolk">村民 ×{setup.townsfolk}</span>
          <span className="chip chip-outsider">外来者 ×{setup.outsider}</span>
          <span className="chip chip-minion">爪牙 ×{setup.minion}</span>
          <span className="chip chip-demon">恶魔 ×{setup.demon}</span>
          <p className="hint">男爵在场时会改为 +2 外来者 / -2 村民,天黑后才见分晓……</p>
        </div>
      )}
      <div className="btn-row">
        <button className="btn ghost" onClick={onBack}>返回</button>
        <button
          className="btn primary"
          onClick={() => onStart(name.trim() || "我", count, scriptId)}
        >
          天黑请闭眼
        </button>
      </div>
    </div>
  );
}