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
    clarify: "信息在首夜自动获得,不能选择查谁;之后的夜晚不再有任何新信息",
    symbol: "洗"
  },
  librarian: {
    id: "librarian", name: "图书管理员", team: TEAM.TOWNSFOLK, night: "first", input: false,
    ability: "在你的首个夜晚,你会得知两名玩家之一是某个特定的外来者,或得知场上没有外来者。",
    clarify: "信息在首夜自动获得,不能选择查谁;之后的夜晚不再有任何新信息",
    symbol: "书"
  },
  investigator: {
    id: "investigator", name: "调查员", team: TEAM.TOWNSFOLK, night: "first", input: false,
    ability: "在你的首个夜晚,你会得知两名玩家之一是某个特定的爪牙。",
    clarify: "信息在首夜自动获得,不能选择查谁;之后的夜晚不再有任何新信息",
    symbol: "查"
  },
  chef: {
    id: "chef", name: "厨师", team: TEAM.TOWNSFOLK, night: "first", input: false,
    ability: "在你的首个夜晚,你会得知场上有多少对相邻的邪恶玩家。",
    clarify: "只在首夜得到一个数字;不选人,不保护任何人",
    symbol: "厨"
  },
  empath: {
    id: "empath", name: "共情者", team: TEAM.TOWNSFOLK, night: "both", input: false,
    ability: "每个夜晚,你会得知与你相邻的两名存活玩家中有几名邪恶玩家。",
    clarify: "只感知自己左右两名相邻存活玩家,不能自选目标;邻座死亡后感知对象会顺延",
    symbol: "心"
  },
  fortuneteller: {
    id: "fortuneteller", name: "占卜师", team: TEAM.TOWNSFOLK, night: "both", input: true, targets: 2,
    prompt: "选择两名玩家,占卜他们之中是否有恶魔",
    ability: "每个夜晚,选择两名玩家:你会得知他们之中是否有恶魔。场上有一名善良玩家会被你的能力误判为恶魔。",
    clarify: "答案只有『有/没有恶魔』;『没有』只排除恶魔,两人仍可能是爪牙,绝不等于两人是好人;红鲱鱼好人会被永久误报为『有恶魔』;不存在『查村民』这种信息",
    symbol: "卜"
  },
  undertaker: {
    id: "undertaker", name: "送葬者", team: TEAM.TOWNSFOLK, night: "other", input: false,
    ability: "每个夜晚(首夜除外),你会得知今天白天被处决玩家的角色。",
    clarify: "只能得知被处决者的角色;夜晚被恶魔杀死的人查不到",
    symbol: "葬"
  },
  monk: {
    id: "monk", name: "僧侣", team: TEAM.TOWNSFOLK, night: "other", input: true, targets: 1, notSelf: true,
    prompt: "选择一名玩家保护(不能是自己)",
    ability: "每个夜晚(首夜除外),选择一名其他玩家:今晚恶魔无法杀死他。",
    clarify: "只能保护别人,不能保护自己;也不会知道保护是否真的挡了刀",
    symbol: "僧"
  },
  ravenkeeper: {
    id: "ravenkeeper", name: "守鸦人", team: TEAM.TOWNSFOLK, night: "other", input: true, targets: 1,
    prompt: "你死了!选择一名玩家,得知他的真实角色",
    ability: "如果你在夜晚死亡,你会被唤醒并选择一名玩家:你会得知他的角色。",
    clarify: "活着的时候没有任何信息;只有夜里被杀的那一刻才能查一个人",
    symbol: "鸦"
  },
  virgin: {
    id: "virgin", name: "圣女", team: TEAM.TOWNSFOLK, night: null, input: false,
    ability: "你首次被提名时,如果提名你的是村民,他会被立刻处决。",
    clarify: "纯被动能力,只在首次被提名时可能触发;主动跳圣女身份本身不触发任何效果",
    symbol: "圣"
  },
  slayer: {
    id: "slayer", name: "杀手", team: TEAM.TOWNSFOLK, night: null, input: false,
    ability: "整局游戏限一次,在白天公开选择一名玩家:如果他是恶魔,他死亡。",
    clarify: "白天公开开枪,全场限一次;目标是恶魔则当场死,否则毫无效果;这是善良验人/斩杀的重要手段,残局还捏着不用等于没有这个角色",
    symbol: "杀"
  },
  soldier: {
    id: "soldier", name: "士兵", team: TEAM.TOWNSFOLK, night: null, input: false,
    ability: "你不会被恶魔杀死。",
    clarify: "只免疫恶魔的夜杀,不免疫白天处决",
    symbol: "兵"
  },
  mayor: {
    id: "mayor", name: "镇长", team: TEAM.TOWNSFOLK, night: null, input: false,
    ability: "如果场上只剩三名存活玩家且当天没有处决,你的阵营获胜。如果你在夜晚将被杀死,可能会有另一名玩家代替你死亡。",
    clarify: "残局关键:剩3人且当天不处决=善良直接获胜;若可信的镇长在场,3人残局可以选择不处决",
    symbol: "长"
  },
  butler: {
    id: "butler", name: "管家", team: TEAM.OUTSIDER, night: "both", input: true, targets: 1, notSelf: true,
    prompt: "选择一名玩家作为你的主人",
    ability: "每个夜晚,选择一名玩家作为你的主人:明天白天,只有当他投票时,你才能投票。",
    clarify: "只限制自己的投票,没有任何查验或保护效果",
    symbol: "管"
  },
  drunk: {
    id: "drunk", name: "酒鬼", team: TEAM.OUTSIDER, night: null, input: false, hidden: true, noAbility: true,
    ability: "你以为你是一个村民角色,但其实不是。",
    clarify: "酒鬼自己不知道自己是酒鬼;他以为的村民能力得到的信息可能全是假的",
    symbol: "醉"
  },
  recluse: {
    id: "recluse", name: "隐士", team: TEAM.OUTSIDER, night: null, input: false,
    ability: "你可能被当作邪恶阵营、爪牙或恶魔,即使你已死亡。",
    clarify: "没有任何夜间能力,不会得到任何信息;唯一特性是可能被别人的查验误判为邪恶",
    symbol: "隐"
  },
  saint: {
    id: "saint", name: "圣徒", team: TEAM.OUTSIDER, night: null, input: false,
    ability: "如果你被处决,你的阵营落败。",
    clarify: "只有被白天处决才落败;被恶魔夜杀不触发任何效果",
    symbol: "徒"
  },
  poisoner: {
    id: "poisoner", name: "投毒者", team: TEAM.MINION, night: "both", input: true, targets: 1,
    prompt: "选择一名玩家下毒",
    ability: "每个夜晚,选择一名玩家:他直到明天黄昏中毒。",
    clarify: "中毒者的能力失效、得到的信息可能是假的;这是场上假信息的主要来源之一",
    symbol: "毒"
  },
  spy: {
    id: "spy", name: "间谍", team: TEAM.MINION, night: "both", input: false,
    ability: "每个夜晚,你可以查看魔典。你可能被当作善良阵营、村民或外来者,即使你已死亡。",
    clarify: "知道所有人的真实身份;且可能被查验误判为善良",
    symbol: "谍"
  },
  scarletwoman: {
    id: "scarletwoman", name: "猩红夫人", team: TEAM.MINION, night: null, input: false,
    ability: "如果场上有五名或更多存活玩家且恶魔死亡,你变成那个恶魔。",
    clarify: "存活≥5人时处决/击杀恶魔可能不会结束游戏,因为她会接任恶魔",
    symbol: "红"
  },
  baron: {
    id: "baron", name: "男爵", team: TEAM.MINION, night: null, input: false,
    ability: "游戏设置时,增加两名外来者。[+2外来者]",
    clarify: "没有夜间动作,唯一影响是配置多2个外来者;数外来者数量是抓男爵的关键",
    setupModifier: { outsider: 2, townsfolk: -2 },
    symbol: "爵"
  },
  imp: {
    id: "imp", name: "小恶魔", team: TEAM.DEMON, night: "other", input: true, targets: 1,
    prompt: "选择一名玩家杀死(选择自己则传位给爪牙)",
    ability: "每个夜晚(首夜除外),选择一名玩家:他死亡。如果你以此方式杀死自己,一名爪牙会变成小恶魔。",
    clarify: "首夜不杀人;僧侣保护/士兵免疫会让夜晚出现平安夜",
    symbol: "魔"
  }
};


ROLES.ravenkeeper.nightHint = "只有当你在夜里死亡时,才会被唤醒查验一名玩家。";
ROLES.scarletwoman.nightHint = "你的能力是被动的:恶魔死亡且场上仍有至少五名存活玩家时,你会变成新的恶魔。";
ROLES.baron.nightHint = "你的能力在发牌时已经生效,夜里无需行动。";
ROLES.imp.skipHints = {
  firstNight: "首夜是平安夜:恶魔不能杀人。从第二晚开始,每晚选择一名玩家杀死。"
};

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
    targetPolicy: { count: 1, aliveOnly: true, notSelf: true }
  }
];

export const RULES_BRIEF = [
  "《血染钟楼·暗流涌动》规则要点:",
  "- 村民和外来者属于善良阵营;爪牙和恶魔属于邪恶阵营。",
  "- 恶魔(小恶魔)每晚杀一人(首夜除外)。恶魔死亡则善良获胜;场上只剩两名存活玩家则邪恶获胜。",
  "- 白天所有人讨论,可以提名;得票达到存活人数一半且高于当日最高票者,黄昏时被处决。",
  "- 死亡玩家仍可说话,保留最后一次投票机会(遗书票)。",
  "- 信息可能是假的:中毒、酒鬼、间谍误导、隐士误判、占卜师的红鲱鱼都会制造假信息。"
].join("\n");

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
  rulesBrief: RULES_BRIEF,
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
