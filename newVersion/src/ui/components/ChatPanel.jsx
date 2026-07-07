import React, { useState, useRef, useEffect } from "react";
import { Icon } from "./Icon.jsx";

/** 右侧面板:公共聊天 / 私聊 / 事件记录 */
export function ChatPanel({ view, chat, session }) {
  const [tab, setTab] = useState("chat"); // chat | whisper | log
  const [text, setText] = useState("");
  const [whisperTo, setWhisperTo] = useState(null);
  const scrollRef = useRef(null);

  const whisperMsgs = chat.filter((c) => c.to != null);
  const publicMsgs = chat.filter((c) => c.to == null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat.length, view.log.length, tab]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    const to = tab === "whisper" ? whisperTo : null;
    if (tab === "whisper" && to == null) return;
    const res = session.sendChat(t, to);
    if (res && res.error) return; // 夜晚禁言等
    setText("");
  };

  const canChat = view.phase !== "night";
  const others = view.seats.filter((s) => s.seat !== view.seat);

  return (
    <div className="chat-panel">
      <div className="chat-tabs">
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}><Icon name="chat" /> 广场</button>
        <button className={tab === "whisper" ? "active" : ""} onClick={() => setTab("whisper")}>
          <Icon name="whisper" /> 私聊{whisperMsgs.length ? ` (${whisperMsgs.length})` : ""}
        </button>
        <button className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}><Icon name="log" /> 事件</button>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {tab === "chat" &&
          publicMsgs.map((c) => (
            <div key={c.id} className={`msg ${c.fromSeat === view.seat ? "mine" : ""}`}>
              <span className="msg-from">{c.fromName}</span>
              <span className="msg-text">{c.text}</span>
            </div>
          ))}
        {tab === "whisper" &&
          whisperMsgs
            .filter((c) => whisperTo == null || c.fromSeat === whisperTo || c.to === whisperTo || c.fromSeat === view.seat)
            .map((c) => (
              <div key={c.id} className={`msg whisper ${c.fromSeat === view.seat ? "mine" : ""}`}>
                <span className="msg-from">
                  {c.fromName} → {view.seats[c.to] ? view.seats[c.to].name : "?"}
                </span>
                <span className="msg-text">{c.text}</span>
              </div>
            ))}
        {tab === "log" &&
          view.log.map((l, i) => (
            <div key={i} className={`log-entry log-${l.type}`}>
              {l.text}
            </div>
          ))}
      </div>

      {tab === "whisper" && (
        <select
          className="whisper-select"
          value={whisperTo == null ? "" : whisperTo}
          onChange={(e) => setWhisperTo(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">选择私聊对象……</option>
          {others.map((s) => (
            <option key={s.seat} value={s.seat}>
              {s.name}{s.alive ? "" : " (死亡)"}
            </option>
          ))}
        </select>
      )}

      {tab !== "log" && (
        <div className="chat-input-row">
          <input
            value={text}
            placeholder={canChat ? (tab === "whisper" ? "耳语只有对方能看到…" : "向广场发言…") : "夜晚请保持安静"}
            disabled={!canChat}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="btn small" disabled={!canChat} onClick={send}>发送</button>
        </div>
      )}
    </div>
  );
}
