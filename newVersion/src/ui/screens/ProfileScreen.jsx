import React, { useEffect, useMemo, useRef, useState } from "react";
import { uploadUserAvatar } from "../../session/firebase.js";
import { calculatePlayerStats, sortedResults } from "../../session/gameHistory.js";
import {
  ensureUserProfile,
  getGameReplay,
  watchUserGameResults,
  watchUserProfile
} from "../../session/profileStore.js";
import { Icon } from "../components/Icon.jsx";
import { RoleIcon } from "../components/RoleIcon.jsx";

function percent(value) {
  return value == null ? "--" : `${value}%`;
}

function formatTime(ts) {
  if (!ts) return "未知时间";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function Avatar({ profile, user }) {
  const url = profile?.photoURL || user?.photoURL || "";
  const label = profile?.displayName || user?.displayName || user?.email || "玩家";
  if (url) return <img className="profile-avatar-img" src={url} alt={`${label} 的头像`} />;
  return <div className="profile-avatar-fallback">{label.slice(0, 1).toUpperCase()}</div>;
}

export function ProfileScreen({ user, onBack }) {
  const fileInput = useRef(null);
  const [profile, setProfile] = useState(null);
  const [results, setResults] = useState({});
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [showReplays, setShowReplays] = useState(false);

  useEffect(() => {
    ensureUserProfile(user).catch((error) => console.warn("同步用户资料失败:", error));
    const unProfile = watchUserProfile(user.uid, setProfile);
    const unResults = watchUserGameResults(user.uid, setResults);
    return () => {
      unProfile();
      unResults();
    };
  }, [user]);

  const stats = useMemo(() => calculatePlayerStats(results), [results]);
  const replayItems = useMemo(() => sortedResults(results), [results]);
  const displayName = profile?.displayName || user.displayName || "钟楼玩家";

  const chooseAvatar = () => fileInput.current?.click();
  const uploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      await uploadUserAvatar(file);
      setMessage("头像已更新");
    } catch (error) {
      setMessage(error.message || "头像上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="profile-page">
      <header className="profile-header">
        <button className="link-btn" onClick={onBack}><Icon name="back" /> 返回大厅</button>
      </header>

      <main className="profile-layout">
        <section className="profile-hero panel">
          <div className="profile-avatar-wrap"><Avatar profile={profile} user={user} /></div>
          <div className="profile-main-text">
            <h1>{displayName}</h1>
            <p>{profile?.email || user.email}</p>
          </div>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={uploadAvatar} />
          <button className="btn primary" disabled={uploading} onClick={chooseAvatar}>
            <Icon name="upload" /> {uploading ? "上传中..." : "设置头像"}
          </button>
        </section>

        {message && <p className="profile-message">{message}</p>}

        <section className="profile-stats" aria-label="对局统计">
          <div className="stat-card panel">
            <span>总对局</span>
            <strong>{stats.totalGames}</strong>
          </div>
          <div className="stat-card panel">
            <span>好人胜率</span>
            <strong>{percent(stats.goodWinRate)}</strong>
            <small>{stats.goodGames} 局</small>
          </div>
          <div className="stat-card panel">
            <span>坏人胜率</span>
            <strong>{percent(stats.evilWinRate)}</strong>
            <small>{stats.evilGames} 局</small>
          </div>
        </section>

        <section className="profile-actions panel">
          <div>
            <h2>对局复盘</h2>
            <p className="hint">查看你作为玩家参与过的已结束对局。</p>
          </div>
          <button className="btn" onClick={() => setShowReplays(true)}>
            <Icon name="replay" /> 查看对局复盘
          </button>
        </section>
      </main>

      {showReplays && (
        <ReplayModal items={replayItems} onClose={() => setShowReplays(false)} />
      )}
    </div>
  );
}

function ReplayModal({ items, onClose }) {
  const [selected, setSelected] = useState(null);
  const [replay, setReplay] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const openReplay = async (item) => {
    setSelected(item);
    setReplay(null);
    setError("");
    setLoading(true);
    try {
      const data = await getGameReplay(item.replayId || item.gameId);
      if (!data) throw new Error("没有找到这局复盘");
      setReplay(data);
    } catch (e) {
      setError(e.message || "读取复盘失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel replay-modal" onClick={(e) => e.stopPropagation()}>
        <div className="replay-modal-head">
          <h2>{replay ? "复盘详情" : "对局复盘"}</h2>
          <button className="link-btn" onClick={onClose}>关闭</button>
        </div>

        {!replay && (
          <div className="replay-list">
            {!items.length && <p className="hint">还没有已结束的玩家对局。</p>}
            {items.map((item) => (
              <button key={item.gameId} className="replay-row" onClick={() => openReplay(item)}>
                <span>
                  <strong>{item.scriptName || item.scriptId || "未知剧本"}</strong>
                  <small>{formatTime(item.endedAt)} · {item.alignment === "good" ? "好人" : "坏人"} · {item.roleName || item.roleId}</small>
                </span>
                <b className={item.won ? "win" : "lose"}>{item.won ? "胜利" : "失败"}</b>
              </button>
            ))}
          </div>
        )}

        {loading && <p className="hint">正在翻开这局魔典...</p>}
        {error && <p className="error">{error}</p>}
        {replay && (
          <ReplayDetail replay={replay} selected={selected} onBack={() => setReplay(null)} />
        )}
      </div>
    </div>
  );
}

function ReplayDetail({ replay, selected, onBack }) {
  return (
    <div className="replay-detail">
      <button className="link-btn" onClick={onBack}><Icon name="back" /> 返回列表</button>
      <div className="replay-summary">
        <strong className={replay.winner === "good" ? "win" : "lose"}>
          {replay.winner === "good" ? "好人阵营胜利" : "邪恶阵营胜利"}
        </strong>
        <span>{replay.winReason}</span>
        <small>{formatTime(replay.endedAt)} · {replay.scriptName || replay.scriptId}</small>
        {selected && <small>你是 {selected.roleName || selected.roleId} · {selected.won ? "获胜" : "落败"}</small>}
      </div>

      <section>
        <h3>座位与身份</h3>
        <div className="replay-seat-grid">
          {(replay.players || []).map((p) => (
            <div key={p.seat} className={`replay-seat align-${p.alignment}`}>
              <RoleIcon roleId={p.roleId} scriptId={replay.scriptId} size={34} />
              <span>{p.seat + 1}. {p.name}</span>
              <small>{p.roleName} · {p.alignment === "good" ? "好人" : "坏人"}</small>
            </div>
          ))}
        </div>
      </section>

      <ReplayTextSection title="事件日志" items={replay.publicLog} />
      <ReplayTextSection title="说书人记录" items={replay.storytellerNotes} />
      <ReplayTextSection title="聊天记录" items={(replay.chat || []).map((c) => ({ text: `${c.fromName || "?"}${c.to == null ? "" : " 私聊"}: ${c.text}` }))} />
      <section>
        <h3>私密信息记录</h3>
        <div className="private-replay-list">
          {(replay.players || []).map((p) => (
            <div key={p.seat}>
              <strong>{p.name}</strong>
              {(p.privateLog || []).length ? p.privateLog.map((l, i) => <p key={i}>{l.text}</p>) : <p className="hint">无记录</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReplayTextSection({ title, items }) {
  const finalItems = Array.isArray(items) ? items : [];
  return (
    <section>
      <h3>{title}</h3>
      <div className="replay-log-list">
        {finalItems.length ? finalItems.map((item, i) => <p key={i}>{item.text || item}</p>) : <p className="hint">无记录</p>}
      </div>
    </section>
  );
}
