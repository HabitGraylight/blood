import React from "react";

export function SettingsModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <h2>AI 大模型配置</h2>
        <p className="hint">
          当前版本固定使用 MiniMax-M3。请在项目环境变量中配置 MINIMAX_API_KEY 或 ANTHROPIC_API_KEY,
          前端不再提供手动填写 API Key 和 endpoint 的入口。
        </p>
        <div className="btn-row">
          <button className="btn primary" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>
  );
}
