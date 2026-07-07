import React, { useState } from "react";
import { getLLMConfig, saveLLMConfig, DEFAULT_LLM_CONFIG } from "../../ai/llm.js";

/** LLM 配置(保存在浏览器本地,不会上传) */
export function SettingsModal({ onClose }) {
  const [cfg, setCfg] = useState(getLLMConfig());
  const upd = (k) => (e) => setCfg({ ...cfg, [k]: e.target.value });

  const save = () => {
    saveLLMConfig(cfg);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <h2>AI 大模型设置</h2>
        <p className="hint">
          配置 OpenAI 兼容接口后,AI 玩家将用大模型推理、发言、投票。
          留空 API Key 则使用内置基础 AI。配置仅保存在你的浏览器中。
        </p>
        <label className="field">
          <span>接口地址</span>
          <input value={cfg.endpoint} onChange={upd("endpoint")}
            placeholder={DEFAULT_LLM_CONFIG.endpoint} />
        </label>
        <label className="field">
          <span>API Key</span>
          <input type="password" value={cfg.apiKey} onChange={upd("apiKey")}
            placeholder="sk-..." />
        </label>
        <label className="field">
          <span>模型</span>
          <input value={cfg.model} onChange={upd("model")}
            placeholder={DEFAULT_LLM_CONFIG.model} />
        </label>
        <div className="btn-row">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
