import React from "react";
import { isFirebaseConfigured } from "../../session/firebase.js";
import { isLLMConfigured } from "../../ai/llm.js";
import { Icon } from "../components/Icon.jsx";
import { HomeBackdrop } from "../components/HomeBackdrop.jsx";

export function HomeScreen({ user, onSingle, onMulti, onLogout, onProfile }) {
  const fbReady = isFirebaseConfigured();
  const llmReady = isLLMConfigured();
  const label = user?.displayName || user?.email || "已登录";
  const initial = label.slice(0, 1).toUpperCase();

  return (
    <div className="home">
      <div className="account-pill">
        <button className="account-profile-btn" onClick={onProfile} title="个人中心">
          {user?.photoURL ? <img src={user.photoURL} alt="头像" /> : <b>{initial}</b>}
          <span>个人中心</span>
        </button>
        <button className="link-btn" onClick={onLogout}>退出</button>
      </div>

      <div className="home-tower" aria-hidden>
        <div className="tower-moon" />
        <HomeBackdrop />
      </div>
      <h1 className="home-title">血染钟楼</h1>
      <p className="home-subtitle">Blood on the Clocktower · 暗流涌动</p>

      <div className="home-cards">
        <button className="mode-card" onClick={onSingle}>
          <span className="mode-icon"><Icon name="day" size={32} /></span>
          <span className="mode-name">单人 · 与 AI 对局</span>
          <span className="mode-desc">
            与 4-14 名 AI 玩家同行推理
            {llmReady ? "(已启用 MiniMax-M3 环境变量模式)" : "(未配置大模型环境变量,使用基础 AI)"}
          </span>
        </button>
        <button
          className={`mode-card ${fbReady ? "" : "mode-card-disabled"}`}
          onClick={fbReady ? onMulti : undefined}
        >
          <span className="mode-icon"><Icon name="night" size={32} /></span>
          <span className="mode-name">多人 · 联机房间</span>
          <span className="mode-desc">
            {fbReady
              ? "创建或加入房间,你的账号 uid 会用于同步身份与视图"
              : "需要先在 src/firebase-config.js 填入 Firebase 配置"}
          </span>
        </button>
      </div>

      <div className="home-footer">
        <span className="home-note">AI 模型固定为 MiniMax-M3,通过环境变量配置</span>
        <span className="home-note">线上适配版 · 自动说书人 · 顺位举手投票 · 私聊耳语</span>
      </div>
    </div>
  );
}
