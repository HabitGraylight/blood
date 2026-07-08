import React, { useState } from "react";
import { AVAILABLE_SCRIPTS, getSetupForScript, DEFAULT_SCRIPT_ID } from "../../scripts/registry.js";
import { ScriptSelect } from "../components/ScriptSelect.jsx";

export function SingleSetupScreen({ onStart, onBack }) {
  const [name, setName] = useState("我");
  const [count, setCount] = useState(8);
  const [scriptId, setScriptId] = useState(DEFAULT_SCRIPT_ID);
  const [aiStoryteller, setAiStoryteller] = useState(true);
  const script = AVAILABLE_SCRIPTS.find((s) => s.id === scriptId) || AVAILABLE_SCRIPTS[0];
  const setup = getSetupForScript(scriptId, count);

  return (
    <div className="setup-screen panel">
      <h2>单人对局设置</h2>
      <div className="field">
        <span>剧本</span>
        <ScriptSelect scripts={AVAILABLE_SCRIPTS} value={scriptId} onChange={setScriptId} />
      </div>
      <p className="hint">{script.summary}</p>
      <label className="field">
        <span>你的名字</span>
        <input value={name} maxLength={8} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field range-field">
        <span>玩家总数(含你): {count} 人</span>
        <input
          type="range"
          min={script.minPlayers}
          max={script.maxPlayers}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </label>
      {setup && (
        <div className="setup-preview">
          <span className="chip chip-townsfolk">村民 x{setup.townsfolk}</span>
          <span className="chip chip-outsider">外来者 x{setup.outsider}</span>
          <span className="chip chip-minion">爪牙 x{setup.minion}</span>
          <span className="chip chip-demon">恶魔 x{setup.demon}</span>
          <p className="hint">男爵在场时会改为 +2 外来者 / -2 村民，天黑后才见分晓。</p>
        </div>
      )}
      <label className="field checkbox-field">
        <span>AI 说书人</span>
        <input
          type="checkbox"
          checked={aiStoryteller}
          onChange={(e) => setAiStoryteller(e.target.checked)}
        />
      </label>
      <p className="hint">
        {aiStoryteller
          ? "AI 说书人会像真人说书人一样掌控局面，裁定误注册与假信息，控制白天节奏，并为对局配上旁白。"
          : "关闭后由系统按固定概率自动裁定，使用经典模式。"}
      </p>
      <div className="btn-row">
        <button className="btn ghost" onClick={onBack}>返回</button>
        <button
          className="btn primary"
          onClick={() => onStart(name.trim() || "我", count, scriptId, aiStoryteller)}
        >
          天黑请闭眼
        </button>
      </div>
    </div>
  );
}


