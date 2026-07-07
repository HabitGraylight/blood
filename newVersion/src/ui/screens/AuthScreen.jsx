import React, { useState } from "react";
import { loginWithEmail, registerWithEmail, isFirebaseConfigured } from "../../session/firebase.js";
import { Icon } from "../components/Icon.jsx";

function messageFor(error) {
  const code = error?.code || "";
  if (code.includes("email-already-in-use")) return "这个邮箱已经注册过,请直接登录。";
  if (code.includes("invalid-email")) return "邮箱格式不正确。";
  if (code.includes("weak-password")) return "密码至少需要 6 位。";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "邮箱或密码不正确。";
  }
  if (code.includes("network-request-failed")) return "网络连接失败,请稍后重试。";
  return error?.message || "登录失败,请检查信息后重试。";
}

export function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isRegister = mode === "register";

  const submit = async (event) => {
    event.preventDefault();
    if (!isFirebaseConfigured()) {
      setError("需要先配置 Firebase 才能登录。请检查 src/firebase-config.js。 ");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (isRegister) {
        await registerWithEmail({ email: email.trim(), password, displayName: displayName.trim() });
      } else {
        await loginWithEmail({ email: email.trim(), password });
      }
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-stage" aria-hidden>
        <div className="auth-clockface" />
        <div className="auth-tower-mark">血</div>
      </section>

      <form className="auth-card panel" onSubmit={submit}>
        <div className="auth-kicker">Blood on the Clocktower</div>
        <h1>进入钟楼</h1>
        <p className="hint">使用邮箱账号登录后,你的 Firebase uid 会成为稳定玩家身份。刷新页面、重进房间、同步视图都会依赖它。</p>

        <div className="auth-switch" role="tablist" aria-label="登录方式">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>注册</button>
        </div>

        {isRegister && (
          <label className="field">
            <span>昵称</span>
            <input value={displayName} maxLength={12} autoComplete="nickname" onChange={(e) => setDisplayName(e.target.value)} placeholder="说书人 / 玩家名" />
          </label>
        )}

        <label className="field">
          <span>邮箱</span>
          <input value={email} type="email" autoComplete="email" onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        </label>
        <label className="field">
          <span>密码</span>
          <input value={password} type="password" autoComplete={isRegister ? "new-password" : "current-password"} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" required minLength={6} />
        </label>

        {error && <p className="error auth-error">{error}</p>}

        <button className="btn primary auth-submit" disabled={busy} type="submit">
          <Icon name="room" /> {busy ? "处理中..." : isRegister ? "注册并进入" : "登录"}
        </button>
      </form>
    </main>
  );
}
