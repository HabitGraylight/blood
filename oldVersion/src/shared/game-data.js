(function publishGameData(root, factory) {
  const data = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = data;
  } else {
    root.BLOOD_DATA = data;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildGameData() {
  const TEAM_LABELS = {
    townsfolk: "镇民",
    outsider: "外来者",
    minion: "爪牙",
    demon: "恶魔",
    traveler: "旅行者",
    fabled: "传奇"
  };

  const ALIGNMENT_LABELS = {
    good: "善良",
    evil: "邪恶"
  };

  const DEFAULT_SETUP = {
    5: { townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
    6: { townsfolk: 3, outsider: 1, minion: 1, demon: 1 },
    7: { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
    8: { townsfolk: 5, outsider: 1, minion: 1, demon: 1 },
    9: { townsfolk: 5, outsider: 2, minion: 1, demon: 1 },
    10: { townsfolk: 7, outsider: 0, minion: 2, demon: 1 },
    11: { townsfolk: 7, outsider: 1, minion: 2, demon: 1 },
    12: { townsfolk: 7, outsider: 2, minion: 2, demon: 1 },
    13: { townsfolk: 9, outsider: 0, minion: 3, demon: 1 },
    14: { townsfolk: 9, outsider: 1, minion: 3, demon: 1 },
    15: { townsfolk: 9, outsider: 2, minion: 3, demon: 1 }
  };

  const TEAM_AVATAR_COLORS = {
    townsfolk: { background: "#2f5f73", accent: "#8ed0e0" },
    outsider: { background: "#5f4b7a", accent: "#d7b8ff" },
    minion: { background: "#6f354f", accent: "#f0a0bd" },
    demon: { background: "#743126", accent: "#ffb09b" },
    traveler: { background: "#5f5832", accent: "#ecd77a" },
    fabled: { background: "#345f4a", accent: "#99dfba" }
  };

  const ROLE_AVATARS = {
    washerwoman: { symbol: "洗", background: "#2d6172", accent: "#a7d9e6" },
    librarian: { symbol: "书", background: "#375d79", accent: "#bfd7ff" },
    investigator: { symbol: "查", background: "#284f68", accent: "#8fc5ff" },
    chef: { symbol: "厨", background: "#6a4f2f", accent: "#f2c178" },
    empath: { symbol: "心", background: "#486a55", accent: "#a7e0bc" },
    fortuneteller: { symbol: "卜", background: "#5a4c85", accent: "#d7c4ff" },
    undertaker: { symbol: "葬", background: "#46505c", accent: "#c7d2df" },
    monk: { symbol: "僧", background: "#5d6540", accent: "#dce6a0" },
    ravenkeeper: { symbol: "鸦", background: "#2c3349", accent: "#aab8dc" },
    virgin: { symbol: "圣", background: "#7a5570", accent: "#ffd0ea" },
    slayer: { symbol: "猎", background: "#60433f", accent: "#ffb2a8" },
    soldier: { symbol: "兵", background: "#3e5f54", accent: "#a7dbc8" },
    mayor: { symbol: "长", background: "#61562f", accent: "#f0db82" },
    butler: { symbol: "管", background: "#59486f", accent: "#d3baf0" },
    drunk: { symbol: "醉", background: "#604d72", accent: "#e3c0ff" },
    recluse: { symbol: "隐", background: "#4c5264", accent: "#c6ccdf" },
    saint: { symbol: "徒", background: "#69506b", accent: "#edc8f2" },
    poisoner: { symbol: "毒", background: "#753852", accent: "#ffa7c4" },
    spy: { symbol: "谍", background: "#54304f", accent: "#f0a0dc" },
    scarletwoman: { symbol: "红", background: "#7a2f3d", accent: "#ff9cab" },
    baron: { symbol: "爵", background: "#694331", accent: "#e7b187" },
    imp: { symbol: "魔", background: "#7c2f25", accent: "#ff9c88" }
  };

  function role(id, name, team, ability, copies, firstNight, otherNight, extra) {
    const details = extra || {};
    return {
      id,
      name,
      team,
      ability,
      copies,
      firstNight,
      otherNight,
      ...details,
      avatar: normalizeRoleAvatar(id, name, team, details.avatar)
    };
  }

  function normalizeRoleAvatar(id, name, team, avatar) {
    const teamColors = TEAM_AVATAR_COLORS[team] || TEAM_AVATAR_COLORS.townsfolk;
    const preset = ROLE_AVATARS[id] || {};
    const source = { ...preset, ...(avatar || {}) };
    return {
      symbol: String(source.symbol || Array.from(String(name || "?"))[0] || "?").slice(0, 2),
      background: source.background || teamColors.background,
      accent: source.accent || teamColors.accent
    };
  }

  const DEFAULT_SCRIPTS = [
    {
      id: "trouble-brewing-lite",
      name: "Trouble Brewing Lite 可改版",
      note:
        "面向本地原型的基础板。保留角色结构和主持节奏，能力文本为简短摘要，方便后续替换为你的 DIY 角色。",
      setupTable: DEFAULT_SETUP,
      roles: [
        role("washerwoman", "洗衣妇", "townsfolk", "首夜得知两名玩家中有一名特定镇民。", 1, true, false),
        role("librarian", "图书管理员", "townsfolk", "首夜得知两名玩家中有一名特定外来者，或得知没有外来者。", 1, true, false),
        role("investigator", "调查员", "townsfolk", "首夜得知两名玩家中有一名特定爪牙。", 1, true, false),
        role("chef", "厨师", "townsfolk", "首夜得知相邻邪恶玩家对数。", 1, true, false),
        role("empath", "共情者", "townsfolk", "每夜得知两侧最近存活邻座中邪恶人数。", 1, true, true),
        role("fortuneteller", "占卜师", "townsfolk", "每夜选择两名玩家，得知其中是否有恶魔。", 1, true, true),
        role("undertaker", "送葬者", "townsfolk", "每夜得知白天被处决玩家的角色。", 1, false, true),
        role("monk", "僧侣", "townsfolk", "每夜选择除自己外一名玩家，使其当夜免受恶魔杀害。", 1, false, true),
        role("ravenkeeper", "守鸦人", "townsfolk", "若夜晚死亡，醒来选择一名玩家并得知其角色。", 1, false, true),
        role("virgin", "圣女", "townsfolk", "首次被镇民提名时，提名者会被立即处决。", 1, false, false),
        role("slayer", "猎手", "townsfolk", "白天一次性公开选择一名玩家；若其是恶魔则死亡。", 1, false, false),
        role("soldier", "士兵", "townsfolk", "免受恶魔杀害。", 1, false, false),
        role("mayor", "镇长", "townsfolk", "若只剩三人且无人处决，善良获胜；夜晚被攻击时可转移死亡。", 1, false, false),
        role("butler", "管家", "outsider", "每夜选择主人；白天只有主人投票时自己才可投票。", 1, true, true),
        role("drunk", "醉汉", "outsider", "以为自己是某个镇民，但实际没有该能力。", 1, false, false, {
          thinksIsTownsfolk: true
        }),
        role("recluse", "隐士", "outsider", "可能被能力当作邪恶或爪牙/恶魔。", 1, false, false),
        role("saint", "圣徒", "outsider", "若被处决，邪恶获胜。", 1, false, false),
        role("poisoner", "投毒者", "minion", "每夜选择一名玩家，使其到黄昏前中毒。", 1, true, true),
        role("spy", "间谍", "minion", "每夜可查看魔典；可能被能力当作善良或镇民。", 1, true, true),
        role("scarletwoman", "红唇女郎", "minion", "若存活玩家大于等于 5 且恶魔死亡，自己成为恶魔。", 1, false, true),
        role("baron", "男爵", "minion", "设置时加入 2 个外来者并减少 2 个镇民。", 1, false, false, {
          setupModifier: { outsider: 2, townsfolk: -2 }
        }),
        role("imp", "小恶魔", "demon", "每夜除首夜外选择一名玩家死亡；若杀死自己，爪牙之一变为小恶魔。", 1, false, true)
      ],
      nightOrder: {
        first: [
          "poisoner",
          "washerwoman",
          "librarian",
          "investigator",
          "chef",
          "empath",
          "fortuneteller",
          "butler",
          "spy"
        ],
        other: [
          "poisoner",
          "monk",
          "scarletwoman",
          "imp",
          "ravenkeeper",
          "empath",
          "fortuneteller",
          "undertaker",
          "butler",
          "spy"
        ]
      }
    }
  ];

  return { TEAM_LABELS, ALIGNMENT_LABELS, DEFAULT_SETUP, DEFAULT_SCRIPTS, role };
});
