import React, { useMemo, useState, useEffect, useRef } from "react";
import { Icon } from "./Icon.jsx";
import { RoleIcon } from "./RoleIcon.jsx";

/** 待裁定面板:展示引擎挂起的裁量决策,人类点选或交给 AI */
function PendingDecisionPanel({ decision, session, act }) {
  const [suggestion, setSuggestion] = useState(null);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    setSuggestion(null);
    setSuggesting(false);
  }, [decision?.id]);

  if (!decision) return null;

  const askAI = async () => {
    if (suggesting || !session.suggestDecision) return;
    setSuggesting(true);
    const result = await session.suggestDecision();
    setSuggesting(false);
    if (result) setSuggestion(result);
  };

  return (
    <section className="story-panel pending-decision-panel">
      <div className="panel-title"><Icon name="settings" /> 待裁定:{decision.title}</div>
      {decision.detail && <p className="hint">{decision.detail}</p>}
      <div className="decision-options">
        {decision.options.map((o, i) => (
          <button
            key={i}
            className={`btn small ${i === decision.defaultIndex ? "" : "ghost"} ${suggestion && suggestion.choice === i ? "suggested" : ""}`}
            onClick={() =>
              act({
                type: "storytellerDecide",
                decisionId: decision.id,
                choice: i,
                reason: suggestion && suggestion.choice === i ? suggestion.reason : null
              })
            }
          >
            {o.label}
            {i === decision.defaultIndex ? " ·默认" : ""}
            {suggestion && suggestion.choice === i ? " ·AI建议" : ""}
          </button>
        ))}
      </div>
      <div className="decision-tools">
        <button className="btn small ghost" disabled={suggesting} onClick={askAI}>
          {suggesting ? "AI 思考中……" : "让 AI 给建议"}
        </button>
        {suggestion && suggestion.reason && <p className="hint">AI 理由:{suggestion.reason}</p>}
      </div>
    </section>
  );
}

function msLeft(endsAt) {
  if (!endsAt) return "未计时";
  const left = Math.max(0, endsAt - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function StorytellerConsole({ view, chat, session, onLeave }) {
  const [selectedSeat, setSelectedSeat] = useState(view.seats[0]?.seat ?? 0);
  const [infoText, setInfoText] = useState("");
  const [autopilot, setAutopilot] = useState(!!session.storytellerAutopilot);
  const [timelineTab, setTimelineTab] = useState("log"); // log | chat | whisper
  const [narration, setNarration] = useState("");
  const timelineRef = useRef(null);
  const selected = useMemo(
    () => view.seats.find((s) => s.seat === selectedSeat) || view.seats[0],
    [view.seats, selectedSeat]
  );

  const allChat = Array.isArray(chat) ? chat : [];
  const publicMsgs = allChat.filter((c) => c.to == null);
  const whisperMsgs = allChat.filter((c) => c.to != null);
  const nameOf = (seat) => view.seats.find((s) => s.seat === seat)?.name ?? `座位${seat + 1}`;

  useEffect(() => {
    if (timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [allChat.length, view.log.length, timelineTab]);

  const act = (action) => {
    const res = session.storytellerAction ? session.storytellerAction(action) : { ok: false, error: "当前会话没有说书人权限" };
    return res;
  };

  const writeInfo = () => {
    if (!selected || !infoText.trim()) return;
    const res = act({ type: "storytellerSetInfoOverride", seat: selected.seat, text: infoText.trim() });
    if (res.ok) setInfoText("");
  };

  // 公开旁白:写入所有玩家可见的事件日志(宣布死讯、渲染气氛、引导流程)
  const sendNarration = () => {
    const t = narration.trim();
    if (!t) return;
    const res = act({ type: "storytellerNarrate", text: t });
    if (res.ok) setNarration("");
  };

  const cv = view.currentVote;
  const votesUp = cv ? Object.values(cv.votes || {}).filter(Boolean).length : 0;

  return (
    <div className="storyteller-shell">
      <header className="game-header storyteller-header">
        <button className="link-btn" onClick={onLeave}><Icon name="back" /> 离开</button>
        <div className="phase-banner"><Icon name="storyteller" size={22} /><span>说书人 · {view.scriptName}</span></div>
        <label className="autopilot-toggle" title="开启后,所有裁量决策由 AI 说书人自动应答">
          <input
            type="checkbox"
            checked={autopilot}
            onChange={(e) => {
              const enabled = session.setStorytellerAutopilot
                ? session.setStorytellerAutopilot(e.target.checked)
                : false;
              setAutopilot(enabled);
            }}
          />
          <span>AI 托管裁定</span>
        </label>
        <span className="room-code small">第 {view.night} 夜 / 第 {view.day} 天</span>
      </header>

      {view.pendingStorytellerDecision && !autopilot && (
        <PendingDecisionPanel
          decision={view.pendingStorytellerDecision}
          session={session}
          act={act}
        />
      )}

      <main className="storyteller-grid">
        <section className="story-panel grimoire-panel">
          <div className="panel-title"><Icon name="room" /> 魔典</div>
          <div className="grimoire-list">
            {view.seats.map((p) => (
              <button
                key={p.seat}
                className={`grimoire-row ${selectedSeat === p.seat ? "active" : ""} ${p.alive ? "" : "dead"}`}
                onClick={() => setSelectedSeat(p.seat)}
              >
                <RoleIcon roleId={p.role} scriptId={view.scriptId} size={38} />
                <span className="grimoire-main">
                  <strong>{p.seat + 1}. {p.name}</strong>
                  <small>{p.roleName} · {p.alignmentLabel}</small>
                </span>
                <span className="status-stack">
                  {!p.alive && <b>死亡</b>}
                  {p.poisonedBy != null && <b>中毒</b>}
                  {p.redHerring && <b>红鲱鱼</b>}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="story-panel timeline-panel">
          <div className="panel-title"><Icon name="log" /> 事件与阶段</div>
          <div className="phase-tools">
            <button className="btn small" onClick={() => act({ type: "storytellerAdvancePhase", stage: "discussion" })}>公开讨论</button>
            <button className="btn small" onClick={() => act({ type: "storytellerAdvancePhase", stage: "whispers", durationMs: 5 * 60000 })}>私聊 5:00</button>
            <button className="btn small" onClick={() => act({ type: "storytellerAdvancePhase", stage: "nominations", durationMs: 3 * 60000 })}>开放提名 3:00</button>
            <button className="btn dusk small" onClick={() => act({ type: "storytellerAdvancePhase", stage: "nightfall" })}>宣布黄昏</button>
          </div>
          <p className="hint">当前阶段: {view.phase === "night" ? "夜晚" : view.dayStage} · {msLeft(view.dayStageEndsAt)}</p>
          {view.pendingAction && (
            <div className="story-callout">
              夜间等待: {view.seats[view.pendingAction.seat]?.name} · {view.pendingAction.prompt}
            </div>
          )}
          {view.phase === "night" && Array.isArray(view.nightQueue) && view.nightQueue.length > 0 && (
            <div className="night-order">
              <span className="night-order-title">夜间顺位</span>
              {view.nightQueue.map((step, i) => (
                <span
                  key={`${step.seat}-${i}`}
                  className={`night-order-step ${i < view.nightIndex ? "done" : ""} ${i === view.nightIndex ? "current" : ""}`}
                >
                  {view.seats[step.seat]?.name}
                </span>
              ))}
            </div>
          )}
          {cv && (
            <div className="story-callout vote-callout">
              投票中: {nameOf(cv.nominator)} 提名 {nameOf(cv.nominee)} ·
              当前 {votesUp} 票 · 轮到 {nameOf(cv.order[cv.index])} 表决
              ({cv.index}/{cv.order.length})
            </div>
          )}
          {!cv && view.onBlock && view.onBlock.seat != null && (
            <div className="story-callout">
              处决台: {nameOf(view.onBlock.seat)} · {view.onBlock.votes} 票 · 黄昏时将被处决
            </div>
          )}

          <div className="chat-tabs story-tabs">
            <button className={timelineTab === "log" ? "active" : ""} onClick={() => setTimelineTab("log")}>
              <Icon name="log" /> 事件
            </button>
            <button className={timelineTab === "chat" ? "active" : ""} onClick={() => setTimelineTab("chat")}>
              <Icon name="chat" /> 广场{publicMsgs.length ? ` (${publicMsgs.length})` : ""}
            </button>
            <button className={timelineTab === "whisper" ? "active" : ""} onClick={() => setTimelineTab("whisper")}>
              <Icon name="whisper" /> 私聊{whisperMsgs.length ? ` (${whisperMsgs.length})` : ""}
            </button>
          </div>
          <div className="story-log" ref={timelineRef}>
            {timelineTab === "log" &&
              view.log.slice(-120).map((l, i) => <div key={i} className={`log-entry log-${l.type}`}>{l.text}</div>)}
            {timelineTab === "chat" &&
              (publicMsgs.length
                ? publicMsgs.slice(-120).map((c) => (
                    <div key={c.id} className="msg">
                      <span className="msg-from">{c.fromName}</span>
                      <span className="msg-text">{c.text}</span>
                    </div>
                  ))
                : <p className="hint">白天玩家的公开发言会显示在这里。</p>)}
            {timelineTab === "whisper" &&
              (whisperMsgs.length
                ? whisperMsgs.slice(-120).map((c) => (
                    <div key={c.id} className="msg whisper">
                      <span className="msg-from">{c.fromName} → {nameOf(c.to)}</span>
                      <span className="msg-text">{c.text}</span>
                    </div>
                  ))
                : <p className="hint">玩家之间的耳语会显示在这里(仅说书人可见全部)。</p>)}
          </div>
          <div className="chat-input-row narration-row">
            <input
              value={narration}
              maxLength={200}
              placeholder="公开旁白:宣布死讯、渲染气氛、引导流程…"
              onChange={(e) => setNarration(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendNarration()}
            />
            <button className="btn small" disabled={!narration.trim()} onClick={sendNarration}>旁白</button>
          </div>
        </section>

        <section className="story-panel ruling-panel">
          <div className="panel-title"><Icon name="settings" /> 裁定</div>
          {selected && (
            <>
              <div className="selected-player">
                <RoleIcon roleId={selected.role} scriptId={view.scriptId} size={64} />
                <div>
                  <h3>{selected.name}</h3>
                  <p>{selected.roleName} · {selected.teamLabel} · {selected.alignmentLabel}</p>
                  <p className="hint">有效身份: {selected.believedRole || selected.role}</p>
                </div>
              </div>
              <div className="ruling-actions">
                <button className="btn small" onClick={() => act({ type: "storytellerSetNightDeath", seat: selected.seat, dead: true })}>标记死亡</button>
                <button className="btn small ghost" onClick={() => act({ type: "storytellerSetNightDeath", seat: selected.seat, dead: false })}>移出死亡</button>
                <button className="btn small" onClick={() => act({ type: "storytellerResolveMayor", redirectSeat: selected.seat })}>镇长转移到此人</button>
                <button className="btn small ghost" onClick={() => act({ type: "storytellerResolveMayor", redirectSeat: null })}>镇长无人替死</button>
              </div>
              <label className="field">
                <span>写入私密信息</span>
                <textarea value={infoText} onChange={(e) => setInfoText(e.target.value)} rows={4} placeholder="例如: 今晚你得知 3 和 6 之中有一人是小恶魔" />
              </label>
              <button className="btn primary" onClick={writeInfo}>发送给 {selected.name}</button>
              <div className="private-review">
                <h4>私密记录</h4>
                {selected.privateLog.slice(-8).map((l, i) => <p key={i}>{l.text}</p>)}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}