import React, { useEffect, useState, useCallback, useMemo } from "react";
import { TownSquare } from "../components/TownSquare.jsx";
import { RoleCard } from "../components/RoleCard.jsx";
import { ChatPanel } from "../components/ChatPanel.jsx";
import { VoteBanner } from "../components/VoteBanner.jsx";
import { NightPanel } from "../components/NightPanel.jsx";
import { EndOverlay } from "../components/EndOverlay.jsx";
import { StorytellerConsole } from "../components/StorytellerConsole.jsx";
import { Icon } from "../components/Icon.jsx";

/**
 * 游戏主界面。所有数据来自 session.getView()(玩家视角投影),
 * 单机与联机共用,不接触引擎内部状态。
 */
export function GameScreen({ session, onLeave }) {
  const [, force] = useState(0);
  useEffect(() => session.subscribe(() => force((x) => x + 1)), [session]);

  // 目标选择模式: null | 'nominate' | 'slayer' | 'night'
  const [select, setSelect] = useState(null); // { mode, picked: [], max, notSelf }
  const [toast, setToast] = useState("");

  const view = session.getView();
  const chat = session.getChat();
  const seats = Array.isArray(view?.seats) ? view.seats : [];

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }, []);

  // 夜间轮到自己行动时自动进入选择模式
  useEffect(() => {
    if (view && view.pendingAction && (!select || select.mode !== "night")) {
      setSelect({
        mode: "night",
        picked: [],
        max: view.pendingAction.targets,
        notSelf: view.pendingAction.notSelf
      });
    }
    if (view && !view.pendingAction && select && select.mode === "night") {
      setSelect(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view && view.pendingAction]);

  const selectableSeats = useMemo(() => {
    if (!view || !select) return new Set();
    const set = new Set();
    for (const s of view.seats) {
      if (select.mode === "nominate") {
        if (s.alive && !view.nominatedToday.includes(s.seat)) set.add(s.seat);
      } else if (select.mode === "slayer") {
        if (s.alive && s.seat !== view.seat) set.add(s.seat);
      } else if (select.mode === "night") {
        if (select.notSelf && s.seat === view.seat) continue;
        set.add(s.seat);
      }
    }
    return set;
  }, [view, select]);

  const onSeatClick = useCallback(
    (seat) => {
      if (!select || !selectableSeats.has(seat)) return;
      setSelect((prev) => {
        const picked = prev.picked.includes(seat)
          ? prev.picked.filter((s) => s !== seat)
          : [...prev.picked, seat].slice(-(prev.max || 1));
        return { ...prev, picked };
      });
    },
    [select, selectableSeats]
  );

  const confirmSelection = useCallback(() => {
    if (!select) return;
    const picked = select.picked;
    let res;
    if (select.mode === "night") {
      if (picked.length !== (select.max || 1)) {
        showToast(`需要选择 ${select.max} 名玩家`);
        return;
      }
      res = session.nightAction(picked);
    } else if (select.mode === "nominate") {
      if (picked.length !== 1) return showToast("请选择一名玩家");
      res = session.nominate(picked[0]);
    } else if (select.mode === "slayer") {
      if (picked.length !== 1) return showToast("请选择一名玩家");
      res = session.slayerShot(picked[0]);
    }
    if (res && res.error) showToast(res.error);
    else setSelect(null);
  }, [select, session, showToast]);

  if (!view) {
    return (
      <div className="game-loading">
        <p>正在等待房主同步游戏状态……</p>
        <button className="btn ghost" onClick={onLeave}>离开</button>
      </div>
    );
  }

  if (view.isStoryteller) {
    return <StorytellerConsole view={view} chat={chat} session={session} onLeave={onLeave} />;
  }

  const isSpectator = view.isSpectator || view.type === "spectator";
  const isNight = view.phase === "night";
  const phaseText =
    view.phase === "night"
      ? `第 ${view.night} 夜`
      : view.phase === "end"
        ? "游戏结束"
        : `第 ${view.day} 天` + (view.dayStage === "voting" ? " · 投票中" : "");

  return (
    <div className={`game ${isNight ? "night-mode" : ""}`}>
      <header className="game-header">
        <button className="link-btn" onClick={onLeave}><Icon name="back" /> 离开</button>
        <div className="phase-banner">
          <span className="phase-icon"><Icon name={isNight ? "night" : view.phase === "end" ? "end" : "day"} size={22} /></span>
          <span>{phaseText}</span>
        </div>
        {view.storytellerDeciding && (
          <span className="st-deciding">说书人正在裁定……</span>
        )}
        {isSpectator && <span className="room-code small">观战中</span>}
        {session.mode !== "single" && <span className="room-code small">房间 {session.code}</span>}
      </header>

      <div className="game-body">
        <aside className="left-panel">
          {isSpectator ? <SpectatorCard view={view} /> : <RoleCard view={view} />}
        </aside>

        <main className="center-panel">
          {view.currentVote && (
            <VoteBanner view={view} onVote={(up) => !isSpectator && session.vote(up)} />
          )}
          <TownSquare
            view={view}
            selectable={selectableSeats}
            picked={select ? select.picked : []}
            onSeatClick={onSeatClick}
          />
          {!isSpectator && (
            <ActionBar
              view={view}
              session={session}
              select={select}
              setSelect={setSelect}
              confirmSelection={confirmSelection}
              showToast={showToast}
            />
          )}
        </main>

        <aside className="right-panel">
          <ChatPanel view={view} chat={chat} session={session} />
        </aside>
      </div>

      {!isSpectator && isNight && <NightPanel view={view} select={select} confirm={confirmSelection} />}
      {view.phase === "end" && <EndOverlay view={view} onLeave={onLeave} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function SpectatorCard({ view }) {
  const alive = view.seats.filter((s) => s.alive).length;
  return (
    <div className="role-card-wrap">
      <div className="role-card team-townsfolk">
        <div className="role-symbol"><Icon name="storyteller" size={52} /></div>
        <div className="role-meta">
          <h3>观战视角</h3>
          <span className="role-team">公开信息 · {view.scriptName}</span>
        </div>
        <p className="role-ability">你可以查看公开广场、投票进度和公开日志，但不能发言、私聊或执行行动。</p>
        <p className="hint">存活 {alive}/{view.seats.length} · 第 {view.phase === "night" ? view.night + " 夜" : view.day + " 天"}</p>
      </div>
    </div>
  );
}
/** 白天操作按钮区 */
function ActionBar({ view, session, select, setSelect, confirmSelection, showToast }) {
  if (view.phase !== "day") return null;

  const seats = Array.isArray(view.seats) ? view.seats : [];
  const inSelection = select && select.mode !== "night";

  if (view.dayStage === "voting") {
    return <div className="action-bar"><span className="hint">投票进行中……</span></div>;
  }

  if (inSelection) {
    return (
      <div className="action-bar">
        <span className="hint">
          {select.mode === "nominate"
            ? "点击广场上的玩家进行提名"
            : view.you.role === "slayer"
              ? "点击你要射杀的玩家"
              : "点击目标玩家(你不是真杀手,开枪只是唬人,不会有效果)"}
        </span>
        <button className="btn primary" disabled={!select.picked.length} onClick={confirmSelection}>
          确认{select.mode === "nominate" ? "提名" : "开枪"}
        </button>
        <button className="btn ghost" onClick={() => setSelect(null)}>取消</button>
      </div>
    );
  }

  return (
    <div className="action-bar">
      {view.canNominate && (
        <button className="btn" onClick={() => setSelect({ mode: "nominate", picked: [], max: 1 })}>
          <Icon name="nominate" /> 提名
        </button>
      )}
      {view.canSlay && view.you.alive && (view.you.role === "slayer" ? (
        <button className="btn" onClick={() => setSelect({ mode: "slayer", picked: [], max: 1 })}>
          <Icon name="slayer" /> 杀手开枪
        </button>
      ) : (
        <button
          className="btn ghost bluff-btn"
          title="任何玩家都可以公开声称自己是杀手并开枪(虚张声势)。你不是真杀手,不会有任何效果,但可以借此试探或伪装身份。"
          onClick={() => setSelect({ mode: "slayer", picked: [], max: 1 })}
        >
          <Icon name="slayer" /> 声称杀手
        </button>
      ))}
      {session.isHost && view.canEndDay && (
        <button
          className="btn dusk"
          onClick={() => {
            const res = session.endDay();
            if (res && res.error) showToast(res.error);
          }}
        >
          <Icon name="dusk" /> 宣布黄昏
          {view.onBlock && view.onBlock.seat != null
            ? `(处决 ${seats[view.onBlock.seat]?.name || "未知玩家"})`
            : "(无人被处决)"}
        </button>
      )}
    </div>
  );
}



