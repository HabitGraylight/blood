import React from "react";
import { isFirebaseConfigured } from "../../session/firebase.js";
import { isLLMConfigured } from "../../ai/llm.js";

export function HomeScreen({ onSingle, onMulti, onSettings }) {
  const fbReady = isFirebaseConfigured();
  const llmReady = isLLMConfigured();

  return (
    <div className="home">
      <div className="home-tower" aria-hidden>
        <div className="tower-moon" />
        <div className="tower-silhouette" />
      </div>
      <h1 className="home-title">血染钟楼</h1>
      <p className="home-subtitle">Blood on the Clocktower · 暗流涌动</p>

      <div className="home-cards">
        <button className="mode-card" onClick={onSingle}>
          <span className="mode-icon">🕯️</span>
          <span className="mode-name">单人 · 与 AI 对局</span>
          <span className="mode-desc">
            与 4-14 名 AI 玩家同桌推理
            {llmReady ? "(已连接大模型,AI 将像真人一样思考)" : "(未配置大模型,使用基础 AI;可在设置中接入 DeepSeek)"}
          </span>
        </button>
        <button
          className={`mode-card ${fbReady ? "" : "mode-card-disabled"}`}
          onClick={fbReady ? onMulti : undefined}
        >
          <span className="mode-icon">🌙</span>
          <span className="mode-name">多人 · 联机房间</span>
          <span className="mode-desc">
            {fbReady
              ? "创建或加入房间,与好友在线对局,可混入 AI 玩家"
              : "需要先在 src/firebase-config.js 填入 Firebase 配置"}
          </span>
        </button>
      </div>

      <div className="home-footer">
        <button className="link-btn" onClick={onSettings}>⚙ AI 大模型设置</button>
        <span className="home-note">线上适配版:自动说书人 · 顺位举手投票 · 私聊耳语</span>
      </div>
    </div>
  );
}
