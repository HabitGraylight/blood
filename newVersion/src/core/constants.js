export const TEAM = {
  TOWNSFOLK: "townsfolk",
  OUTSIDER: "outsider",
  MINION: "minion",
  DEMON: "demon"
};

export const TEAM_LABELS = {
  townsfolk: "村民",
  outsider: "外来者",
  minion: "爪牙",
  demon: "恶魔"
};

export const ALIGNMENT_LABELS = {
  good: "善良",
  evil: "邪恶"
};

export const DAY_ACTION_STAGES = ["discussion", "whispers", "nominations"];

export function isDayActionable(state) {
  return state && state.phase === "day" && DAY_ACTION_STAGES.includes(state.dayStage);
}

export function seatNo(seat) {
  return Number(seat) + 1;
}
