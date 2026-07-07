import React from "react";
import { Icon } from "./Icon.jsx";

/**
 * 夜晚面板:
 * - 轮到自己行动:显示行动提示,让玩家在广场上点选目标后确认
 * - 否则:显示"闭眼"氛围提示
 */
export function NightPanel({ view, select, confirm }) {
  const pa = view.pendingAction;

  if (!pa) {
    return (
      <div className="night-veil">
        <div className="night-msg">
          <span className="night-stars">✦ ✧ ✦</span>
          <p>夜深了,小镇陷入沉睡……</p>
          <small>其他玩家正在夜色中行动</small>
        </div>
      </div>
    );
  }

  const picked = select ? select.picked : [];
  return (
    <div className="night-action-bar">
      <div className="night-action-inner">
        <span className="night-prompt"><Icon name="night" /> {pa.prompt}</span>
        <span className="night-picked">
          {picked.length
            ? `已选: ${picked.map((s) => view.seats[s].name).join("、")}`
            : `请在广场上点选 ${pa.targets} 名玩家`}
        </span>
        <button
          className="btn primary"
          disabled={picked.length !== pa.targets}
          onClick={confirm}
        >
          确认行动
        </button>
      </div>
    </div>
  );
}
