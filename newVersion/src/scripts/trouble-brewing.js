/**
 * 《暗流涌动》(Trouble Brewing) 剧本数据。
 * 纯数据模块:角色定义、夜间行动顺序、人数配置表。
 */

import { TEAM, TEAM_LABELS, ALIGNMENT_LABELS } from "../core/constants.js";

export { TEAM, TEAM_LABELS, ALIGNMENT_LABELS };

/** 玩家数 -> 各类身份数量 (旅行者不计入) */
export const SETUP_TABLE = {
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

/**
 * 角色定义。
 * night: "first" | "other" | "both" | null — 是否在夜晚被唤醒
 * input: 夜间是否需要玩家作出选择 (选择目标等)
 * targets: 需要选择的目标数量
 */
export const ROLES = {
  washerwoman: {
    id: "washerwoman", name: "洗衣妇", team: TEAM.TOWNSFOLK, night: "first", input: false,
    ability: "在你的首个夜晚,你会得知两名玩家之一是某个特定的村民。",
    symbol: "洗"
  },
  librarian: {
    id: "librarian", name: "图书管理员", team: TEAM.TOWNSFOLK, night: "first", input: false,
    ability: "在你的首个夜晚,你会得知两名玩家之一是某个特定的外来者,或得知场上没有外来者。",
    symbol: "书"
  },
  investigator: {
    id: "investigator", name: "调查员", team: TEAM.TOWNSFOLK, night: "first", input: false,
    ability: "在你的首个夜晚,你会得知两名玩家之一是某个特定的爪牙。",
    symbol: "查"
  },
  chef: {
    id: "chef", name: "厨师", team: TEAM.TOWNSFOLK, night: "first", input: false,
    ability: "在你的首个夜晚,你会得知场上有多少对相邻的邪恶玩家。",
    symbol: "厨"
  },
  empath: {
    id: "empath", name: "共情者", team: TEAM.TOWNSFOLK, night: "both", input: false,
    ability: "每个夜晚,你会得知与你相邻的两名存活玩家中有几名邪恶玩家。",
    symbol: "心"
  },
  fortuneteller: {
    id: "fortuneteller", name: "占卜师", team: TEAM.TOWNSFOLK, night: "both", input: true, targets: 2,
    prompt: "选择两名玩家,占卜他们之中是否有恶魔",
    ability: "每个夜晚,选择两名玩家:你会得知他们之中是否有恶魔。场上有一名善良玩家会被你的能力误判为恶魔。",
    symbol: "卜"
  },
  undertaker: {
    id: "undertaker", name: "送葬者", team: TEAM.TOWNSFOLK, night: "other", input: false,
    ability: "每个夜晚(首夜除外),你会得知今天白天被处决玩家的角色。",
    symbol: "葬"
  },
  monk: {
    id: "monk", name: "僧侣", team: TEAM.TOWNSFOLK, night: "other", input: true, targets: 1, notSelf: true,
    prompt: "选择一名玩家保护(不能是自己)",
    ability: "每个夜晚(首夜除外),选择一名其他玩家:今晚恶魔无法杀死他。",
    symbol: "僧"
  },
  ravenkeeper: {
    id: "ravenkeeper", name: "守鸦人", team: TEAM.TOWNSFOLK, night: "other", input: true, targets: 1,
    prompt: "你死了!选择一名玩家,得知他的真实角色",
    ability: "如果你在夜晚死亡,你会被唤醒并选择一名玩家:你会得知他的角色。",
    symbol: "鸦"
  },
  virgin: {
    id: "virgin", name: "圣女", team: TEAM.TOWNSFOLK, night: null, input: false,
    ability: "你首次被提名时,如果提名你的是村民,他会被立刻处决。",
    symbol: "圣"
  },
  slayer: {
    id: "slayer", name: "杀手", team: TEAM.TOWNSFOLK, night: null, input: false,
    ability: "整局游戏限一次,在白天公开选择一名玩家:如果他是恶魔,他死亡。",
    symbol: "杀"
  },
  soldier: {
    id: "soldier", name: "士兵", team: TEAM.TOWNSFOLK, night: null, input: false,
    ability: "你不会被恶魔杀死。",
    symbol: "兵"
  },
  mayor: {
    id: "mayor", name: "镇长", team: TEAM.TOWNSFOLK, night: null, input: false,
    ability: "如果场上只剩三名存活玩家且当天没有处决,你的阵营获胜。如果你在夜晚将被杀死,可能会有另一名玩家代替你死亡。",
    symbol: "长"
  },
  butler: {
    id: "butler", name: "管家", team: TEAM.OUTSIDER, night: "both", input: true, targets: 1, notSelf: true,
    prompt: "选择一名玩家作为你的主人",
    ability: "每个夜晚,选择一名玩家作为你的主人:明天白天,只有当他投票时,你才能投票。",
    symbol: "管"
  },
  drunk: {
    id: "drunk", name: "酒鬼", team: TEAM.OUTSIDER, night: null, input: false, hidden: true, noAbility: true,
    ability: "你以为你是一个村民角色,但其实不是。",
    symbol: "醉"
  },
  recluse: {
    id: "recluse", name: "隐士", team: TEAM.OUTSIDER, night: null, input: false,
    ability: "你可能被当作邪恶阵营、爪牙或恶魔,即使你已死亡。",
    misregister: {
      chance: 0.6, alignment: "evil",
      teams: [{ team: TEAM.MINION, chance: 0.75 }, { team: TEAM.DEMON }]
    },
    symbol: "隐"
  },
  saint: {
    id: "saint", name: "圣徒", team: TEAM.OUTSIDER, night: null, input: false,
    ability: "如果你被处决,你的阵营落败。",
    symbol: "徒"
  },
  poisoner: {
    id: "poisoner", name: "投毒者", team: TEAM.MINION, night: "both", input: true, targets: 1,
    prompt: "选择一名玩家下毒",
    ability: "每个夜晚,选择一名玩家:他直到明天黄昏中毒。",
    symbol: "毒"
  },
  spy: {
    id: "spy", name: "间谍", team: TEAM.MINION, night: "both", input: false,
    ability: "每个夜晚,你可以查看魔典。你可能被当作善良阵营、村民或外来者,即使你已死亡。",
    misregister: {
      chance: 0.75, alignment: "good",
      teams: [{ team: TEAM.TOWNSFOLK, chance: 0.8 }, { team: TEAM.OUTSIDER }]
    },
    symbol: "谍"
  },
  scarletwoman: {
    id: "scarletwoman", name: "猩红夫人", team: TEAM.MINION, night: null, input: false,
    ability: "如果场上有五名或更多存活玩家且恶魔死亡,你变成那个恶魔。",
    symbol: "红"
  },
  baron: {
    id: "baron", name: "男爵", team: TEAM.MINION, night: null, input: false,
    ability: "游戏设置时,增加两名外来者。[+2外来者]",
    setupModifier: { outsider: 2, townsfolk: -2 },
    symbol: "爵"
  },
  imp: {
    id: "imp", name: "小恶魔", team: TEAM.DEMON, night: "other", input: true, targets: 1,
    prompt: "选择一名玩家杀死(选择自己则传位给爪牙)",
    ability: "每个夜晚(首夜除外),选择一名玩家:他死亡。如果你以此方式杀死自己,一名爪牙会变成小恶魔。",
    symbol: "魔"
  }
};


ROLES.ravenkeeper.nightHint = "只有当你在夜里死亡时,才会被唤醒查验一名玩家。";
ROLES.scarletwoman.nightHint = "你的能力是被动的:恶魔死亡且场上仍有至少五名存活玩家时,你会变成新的恶魔。";
ROLES.baron.nightHint = "你的能力在发牌时已经生效,夜里无需行动。";
ROLES.imp.skipHints = {
  firstNight: "首夜是平安夜:恶魔不能杀人。从第二晚开始,每晚选择一名玩家杀死。"
};

/**
 * AI 兜底启发式的夜间选目标策略(LLM 未配置/失败时使用):
 * avoidEvilTeam 避开邪恶队友;notSelf 不选自己;
 * selfTargetChance 有存活队友时以此概率选择自己(小恶魔传位)。
 * 未声明的角色按角色定义的 notSelf 均匀随机。
 */
ROLES.imp.aiNightPolicy = { avoidEvilTeam: true, notSelf: true, selfTargetChance: 0.06 };
ROLES.poisoner.aiNightPolicy = { avoidEvilTeam: true, notSelf: true };
ROLES.monk.aiNightPolicy = { notSelf: true };
ROLES.butler.aiNightPolicy = { notSelf: true };
ROLES.ravenkeeper.aiNightPolicy = { notSelf: true };

export const DAY_ACTIONS = [
  {
    actionType: "slayerShot",
    roleId: "slayer",
    icon: "slayer",
    label: "杀手开枪",
    bluffLabel: "声称杀手",
    confirmLabel: "开枪",
    hint: "点击你要射击的玩家。",
    bluffHint: "你不是现实杀手时开枪不会有效果,但可以借此试探或伪装身份。",
    publicClaimable: true,
    stages: ["discussion", "whispers", "nominations"],
    onceState: { roleId: "slayer" },
    targetPolicy: { count: 1, aliveOnly: true, notSelf: true },
    // AI 玩家使用该能力时的公开宣告与决策指引(LLM 提示词)
    announceTemplate: "我是杀手,我对 {target} 开枪!",
    aiGuide: [
      "你的角色是杀手,整局限一次的公开开枪能力还没有用。现在决定要不要开枪:公开指认一名存活玩家,如果他是恶魔,他当场死亡、善良几乎立刻获胜;如果不是,什么都不会发生,而你的能力就此耗尽。",
      "时机判断:",
      "- 有较强证据指向某人是恶魔时,开枪是善良最干脆的斩杀手段。",
      "- 残局(存活≤4)再捏着不用,能力会跟着你一起死掉;对最可能是恶魔的人开枪几乎总是正确的——即使打空,也排除了一个嫌疑。",
      "- 多人强烈要求你开枪验证时,一直拒绝会让你自己成为头号嫌疑。",
      "- 前中期证据不足时可以暂不开枪,继续收集信息。"
    ].join("\n")
  }
];

export const FOREIGN_ROLE_WORDS = ["猎手", "大厨", "预言家", "女巫", "守卫", "骑士", "狼人", "先知", "猎人", "白痴", "祖母", "舞蛇人"];

/** 夜间行动顺序 (官方 TB 顺序,爪牙/恶魔互认信息由引擎在队列前单独处理) */
export const NIGHT_ORDER = {
  first: [
    "poisoner", "washerwoman", "librarian", "investigator", "chef",
    "empath", "fortuneteller", "butler", "spy"
  ],
  other: [
    "poisoner", "monk", "scarletwoman", "imp", "ravenkeeper",
    "undertaker", "empath", "fortuneteller", "butler", "spy"
  ]
};

export const SCRIPT = {
  id: "trouble-brewing",
  scriptId: "trouble-brewing",
  name: "暗流涌动",
  englishName: "Trouble Brewing",
  edition: "base",
  complexity: "beginner",
  summary: "最适合新手的经典恶魔追猎剧本,信息、伪装、死亡与投票都很直观。",
  minPlayers: 5,
  maxPlayers: 15,
  roles: ROLES,
  nightOrder: NIGHT_ORDER,
  setupTable: SETUP_TABLE,
  dayActions: DAY_ACTIONS,
  foreignRoleWords: FOREIGN_ROLE_WORDS,
  iconSet: "trouble-brewing",
  rulesProfile: "trouble-brewing"
};

export function rolesByTeam(team) {
  return Object.values(ROLES).filter((r) => r.team === team);
}

export function roleName(roleId) {
  return ROLES[roleId] ? ROLES[roleId].name : roleId;
}
