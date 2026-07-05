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

  function role(id, name, team, ability, copies, firstNight, otherNight, extra) {
    return { id, name, team, ability, copies, firstNight, otherNight, ...(extra || {}) };
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
