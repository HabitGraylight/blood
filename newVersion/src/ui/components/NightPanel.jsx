import React from "react";
import { Icon } from "./Icon.jsx";
import { ROLES } from "../../scripts/trouble-brewing.js";

/**
 * 按角色解释"为什么今晚你不用行动",避免玩家把官方规则误当成 bug。
 * 注意:酒鬼的 view.you.role 是他自认为的角色,按伪装角色解释,不能剧透。
 */
function nightHint(view) {
  const roleId = view.you.role;
  const role = ROLES[roleId];
  if (!role) return "其他玩家正在夜色中行动";
  if (!view.you.alive && roleId !== "ravenkeeper") {
    return "你已死亡,夜里不再行动,静候天亮吧";
  }
  if (roleId === "scarletwoman") {
    return "你的能力是被动的:恶魔死亡时(存活≥5人)你会变成新的恶魔——在那之前,夜里安心睡觉";
  }
  if (roleId === "baron") {
    return "你的能力在发牌时已经生效(+2外来者),夜里无需行动";
  }
  if (roleId === "ravenkeeper") {
    return "只有当你在夜里死亡时,才会被唤醒查验一名玩家";
  }
  if (roleId === "imp" && view.night === 1) {
    return "首夜是平安夜:恶魔不能杀人。从第二夜开始,每晚选择一人杀死";
  }
  if (role.night === "other" && view.night === 1) {
    return "你的能力从第二个夜晚开始生效,今晚不会被唤醒";
  }
  if (role.night === "first" && view.night > 1) {
    return "你的信息只在首夜获得,之后的夜晚无需行动";
  }
  if (!role.night) {
    return "你的角色没有夜间行动,请等待天亮";
  }
  return "今晚会轮到你行动,请留意唤醒提示";
}

/**
 * 夜晚面板:
 * - 轮到自己行动:显示行动提示,让玩家在广场上点选目标后确认
 * - 否则:显示"闭眼"氛围提示 + 本角色的夜间说明
 */
export function NightPanel({ view, select, confirm }) {
  const pa = view.pendingAction;

  if (!pa) {
    return (
      <div className="night-veil">
        <div className="night-msg">
          <span className="night-stars">✦ ✧ ✦</span>
          <p>夜深了,小镇陷入沉睡……</p>
          <small>{nightHint(view)}</small>
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
