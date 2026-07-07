import React, { useMemo, useState, useEffect } from "react";
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
  const selected = useMemo(
    () => view.seats.find((s) => s.seat === selectedSeat) || view.seats[0],
    [view.seats, selectedSeat]
  );

  const act = (action) => {
    const res = session.storytellerAction ? session.storytellerAction(action) : { ok: false, error: "当前会话没有说书人权限" };
    return res;
  };

  const writeInfo = () => {
    if (!selected || !infoText.trim()) return;
    const res = act({ type: "storytellerSetInfoOverride", seat: selected.seat, text: infoText.trim() });
    if (res.ok) setInfoText("");
  };

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
          <div className="story-log">
            {view.log.slice(-80).map((l, i) => <div key={i} className={`log-entry log-${l.type}`}>{l.text}</div>)}
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