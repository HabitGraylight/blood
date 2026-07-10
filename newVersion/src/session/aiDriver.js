/**
 * AI 驱动器:在引擎所在端(单机客户端/联机房主端)调度 AI 玩家行动。
 * - 夜晚:轮到 AI 的行动时自动决策
 * - 白天:按拟人节奏让 AI 发言、追问、私聊串联、考虑提名
 * - 投票:轮到 AI 时自动表决
 * - 私聊:AI 收到耳语后回复,也会主动发起私聊(尤其邪恶队友协调)
 * 所有决策都是异步的(可能走 LLM),用 key 去重防止重复调度。
 *
 * 发言节奏:模拟真人"读上一条消息 + 思考打字"的间隔,
 * 由 _paceGap 统一计算;纯 AI 局(无真人存活)自动加速。
 */
import { playerView } from "../core/view.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export class AIDriver {
  /**
   * @param opts.engine GameEngine
   * @param opts.aiPlayers Map<seat, AIPlayer>
   * @param opts.getChatFor (seat) => 可见聊天记录
   * @param opts.pushChat (fromSeat, text, toSeat|null) => void
   * @param opts.onChange () => void 引擎状态变化后的通知(发布视图等)
   * @param opts.rng
   */
  constructor(opts) {
    this.engine = opts.engine;
    this.aiPlayers = opts.aiPlayers;
    this.getChatFor = opts.getChatFor;
    this.pushChat = opts.pushChat;
    this.onChange = opts.onChange;
    this.rng = opts.rng;
    // AI 说书人:getStoryteller() 返回 AIStoryteller 或 null(人类说书人未托管时)
    this.getStoryteller = opts.getStoryteller || (() => null);
    this.getStorytellerView = opts.getStorytellerView || (() => null);
    this.scheduled = new Set(); // 已调度任务的 key
    this.dayPlan = null; // { day, night, queue, nomQueue, reactBudget, busy }
    this.lastMsgLen = 0; // 上一条聊天消息长度,用于计算"阅读时间"
    this.lastActivityAt = Date.now(); // 最近一次玩家活动(聊天/提名/投票),用于说书人推进节奏
    this.lastHumanActivityAt = 0; // 最近一次真人聊天/操作,用于避免 AI 抢话
    this.disposed = false;
  }

  /** 有玩家活动(聊天/提名/投票等)时调用,说书人会等场面安静后再推进阶段 */
  noteActivity() {
    this.lastActivityAt = Date.now();
  }

  noteHumanActivity() {
    this.noteActivity();
    this.lastHumanActivityAt = Date.now();
  }

  dispose() {
    this.disposed = true;
  }

  _viewOf(seat) {
    return playerView(this.engine.state, seat);
  }

  _humansAlive() {
    return this.engine.state.players.some((p) => p.alive && !this.aiPlayers.has(p.seat));
  }

  /**
   * 拟人化消息间隔:阅读上一条消息的时间 + 自己思考/打字的时间。
   * 有真人在场约 8~16 秒;纯 AI 局加速到约 2~4 秒。
   */
  _paceGap(scale = 1) {
    const read = Math.min(6000, 800 + this.lastMsgLen * 45);
    if (!this._humansAlive()) {
      const think = 2200 + this.rng.int(2800);
      return Math.round((read + think) * 0.4 * scale);
    }
    const humanRead = Math.min(7000, 1500 + this.lastMsgLen * 55);
    const think = 4500 + this.rng.int(4500);
    const paced = Math.max(8000, Math.min(16000, humanRead + think));
    return Math.round(paced * scale);
  }

  async _waitForHumanQuiet({ quietMs = 10000, maxMs = 30000, valid } = {}) {
    if (!this._humansAlive()) return true;
    const start = Date.now();
    while (!this.disposed) {
      if (valid && !valid()) return false;
      const quietFor = Date.now() - this.lastHumanActivityAt;
      if (!this.lastHumanActivityAt || quietFor >= quietMs) return true;
      if (Date.now() - start >= maxMs) return true;
      await delay(1000);
    }
    return false;
  }

  /** 发消息并记录长度(驱动后续节奏) */
  _say(seat, text, toSeat = null) {
    this.lastMsgLen = text.length;
    this.noteActivity();
    return this.pushChat(seat, text, toSeat);
  }

  _traitsOf(seat) {
    const ai = this.aiPlayers.get(seat);
    return (ai && ai.traits) || { aggr: 0.5, talk: 0.5 };
  }

  /** 剧本声明的白天动作类型(如杀手开枪),与提名/投票同样计入"玩家活动" */
  _scriptActionTypes() {
    if (!this._scriptActions) {
      this._scriptActions = new Set(
        (this.engine.script.dayActions || []).map((a) => a.actionType)
      );
    }
    return this._scriptActions;
  }

  _dispatch(action) {
    if (this.disposed || this.engine.state.winner) return;
    const res = this.engine.dispatch(action);
    if (!res.ok) console.warn("AI 动作被拒绝:", action, res.error);
    if (["nominate", "vote"].includes(action.type) || this._scriptActionTypes().has(action.type)) {
      this.noteActivity();
    }
    this.onChange();
    this.tick();
  }

  /**
   * 说书人推进阶段前的等待:至少等 minMs,且最近 quietMs 内无人活动才放行;
   * 超过 maxMs 强制放行(说书人有责任推动游戏,不能无限拖延)。
   * valid() 返回 false 时中止等待(阶段已被其他事件推进)。
   */
  async _waitForLull({ minMs, quietMs, maxMs, valid }) {
    const start = Date.now();
    this.noteActivity(); // 从现在开始计静默,而不是沿用旧时间戳
    while (!this.disposed) {
      if (valid && !valid()) return false;
      const now = Date.now();
      const quietEnough = quietMs <= 0 || now - this.lastActivityAt >= quietMs;
      if (now - start >= minMs && quietEnough) return true;
      if (now - start >= maxMs) return true;
      await delay(1500);
    }
    return false;
  }

  /** 每次状态变化后调用,推进 AI 行动 */
  tick() {
    if (this.disposed) return;
    const s = this.engine.state;
    if (s.winner) return;

    // 待裁定事项优先:AI 说书人裁定;人类说书人则等待控制台操作
    if (s.pendingStorytellerDecision) {
      this._tickStorytellerDecision();
      return;
    }

    if (s.phase === "night") {
      this._tickDuskNarration();
      this._tickNightMemo();
      this._tickNight();
    } else if (s.dayStage === "voting") this._tickVote();
    else if (s.phase === "day") {
      this._tickDawnNarration();
      this._tickDay();
    }
  }

  /** 入夜后让每个 AI 浓缩更新长期记忆(LLM 未配置时为空操作) */
  _tickNightMemo() {
    const s = this.engine.state;
    if (s.night < 2) return; // 第一夜之前没有白天可总结
    this._once(`memo:${s.night}`, async () => {
      for (const [seat, ai] of this.aiPlayers) {
        if (this.disposed || this.engine.state.winner) return;
        await ai.updateMemo(this._viewOf(seat), this.getChatFor(seat));
        await delay(200);
      }
    });
  }

  /* ---------------- AI 说书人 ---------------- */

  _tickStorytellerDecision() {
    const storyteller = this.getStoryteller();
    if (!storyteller) return; // 人类说书人:等待控制台裁定
    const d = this.engine.state.pendingStorytellerDecision;
    this._once(`stdec:${d.id}`, async () => {
      await delay(500 + this.rng.int(800));
      if (this.disposed) return;
      const current = this.engine.state.pendingStorytellerDecision;
      if (!current || current.id !== d.id) return;
      const { choice, reason } = await storyteller.decide(this.getStorytellerView(), current);
      this._dispatch({ type: "storytellerDecide", decisionId: current.id, choice, reason });
    });
  }

  /** 入夜时的处决旁白(有处决才播) */
  _tickDuskNarration() {
    const storyteller = this.getStoryteller();
    if (!storyteller) return;
    const s = this.engine.state;
    if (s.executedToday == null) return;
    const name = s.players[s.executedToday].name;
    this._once(`narrate:dusk:${s.night}`, async () => {
      await delay(400);
      if (this.disposed || this.engine.state.winner) return;
      const text = await storyteller.narrate(this.getStorytellerView(), {
        kind: "execution", name, day: s.day
      });
      if (text) this._dispatch({ type: "storytellerNarrate", text });
    });
  }

  /** 天亮后的氛围旁白(每个白天一次) */
  _tickDawnNarration() {
    const storyteller = this.getStoryteller();
    if (!storyteller) return;
    const s = this.engine.state;
    this._once(`narrate:dawn:${s.day}`, async () => {
      const deaths = s.nightKills.map((seat) => s.players[seat].name);
      const event = { kind: "dawn", day: s.day, deaths };
      await delay(600);
      if (this.disposed) return;
      const text = await storyteller.narrate(this.getStorytellerView(), event);
      if (text && this.engine.state.phase === "day" && !this.engine.state.winner) {
        this._dispatch({ type: "storytellerNarrate", text });
      }
    });
  }

  _once(key, fn) {
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    fn();
  }

  /* ---------------- 夜晚 ---------------- */

  _tickNight() {
    const s = this.engine.state;
    const pa = s.pendingAction;
    if (!pa) return;
    const ai = this.aiPlayers.get(pa.seat);
    if (!ai) return; // 等待真人操作

    this._once(`night:${s.night}:${s.nightIndex}`, async () => {
      await delay(800 + this.rng.int(1500));
      if (this.disposed) return;
      const targets = await ai.decideNightAction(this._viewOf(pa.seat));
      this._dispatch({ type: "nightAction", seat: pa.seat, targets });
    });
  }

  /* ---------------- 投票 ---------------- */

  _tickVote() {
    const s = this.engine.state;
    const cv = s.currentVote;
    if (!cv) return;
    const voter = cv.order[cv.index];
    const ai = this.aiPlayers.get(voter);
    if (!ai) return;

    this._once(`vote:${s.day}:${cv.nominee}:${cv.index}`, async () => {
      await delay(900 + this.rng.int(1600));
      if (this.disposed) return;
      const up = await ai.decideVote(this._viewOf(voter), this.getChatFor(voter));
      this._dispatch({ type: "vote", seat: voter, up });
    });
  }

  /* ---------------- 白天:发言、私聊与提名 ---------------- */

  /** 构建当天行动计划:讨论发言 + 提名前总结 + 主动私聊 */
  _buildDayPlan() {
    const s = this.engine.state;
    const aiSeats = [...this.aiPlayers.keys()].filter((seat) => s.players[seat].alive);
    const humansAlive = this._humansAlive();

    // 有真人在场时只让部分 AI 先开口,把空间留给真人玩家接话。
    const shuffled = this.rng.shuffle(aiSeats);
    const round1Seats = humansAlive ? shuffled.slice(0, Math.min(3, shuffled.length)) : shuffled;
    const round1 = round1Seats.map((seat) => ({ kind: "speak", seat, round: "信息交换" }));
    const discussionLater = [];
    const nominationLater = [];

    for (const seat of this.rng.shuffle(aiSeats)) {
      const chance = humansAlive ? 0.15 + 0.35 * this._traitsOf(seat).talk : 0.3 + 0.55 * this._traitsOf(seat).talk;
      if (this.rng.chance(chance)) {
        discussionLater.push({ kind: "speak", seat, round: "质询回应" });
      }
    }
    for (const seat of this.rng.shuffle(aiSeats)) {
      const chance = humansAlive ? 0.1 + 0.25 * this._traitsOf(seat).talk : 0.2 + 0.45 * this._traitsOf(seat).talk;
      if (this.rng.chance(chance)) {
        nominationLater.push({ kind: "speak", seat, round: "提名前总结", requiresNominationStage: true });
      }
    }

    // 主动私聊:邪恶队友协调优先;社交型玩家找人串联(优先真人)
    const whispers = [];
    for (const seat of aiSeats) {
      const view = this._viewOf(seat);
      const evilInfo = view.you.evilInfo;
      if (evilInfo) {
        const mates = [evilInfo.demonSeat, ...evilInfo.minionSeats].filter(
          (m) => m !== seat && s.players[m] && s.players[m].alive
        );
        if (mates.length && this.rng.chance(0.55)) {
          whispers.push({ kind: "whisper", from: seat, to: this.rng.pick(mates), isTeammate: true });
          continue;
        }
      }
      if (this.rng.chance(0.1 + 0.3 * this._traitsOf(seat).talk)) {
        const others = s.players.filter((p) => p.alive && p.seat !== seat);
        if (!others.length) continue;
        const weighted = others.flatMap((p) => (this.aiPlayers.has(p.seat) ? [p] : [p, p, p]));
        whispers.push({ kind: "whisper", from: seat, to: this.rng.pick(weighted).seat, isTeammate: false });
      }
    }
    const maxWhispers = humansAlive ? 2 : 4;
    for (const w of this.rng.shuffle(whispers).slice(0, maxWhispers)) {
      discussionLater.splice(this.rng.int(discussionLater.length + 1), 0, w);
    }

    // 拥有剧本白天主动能力的 AI(含自认为拥有的伪装身份,如以为自己是杀手的酒鬼):
    // 每天在讨论后段考虑一次是否使用。动作列表来自玩家视图,不含任何角色硬编码。
    for (const seat of aiSeats) {
      const view = this._viewOf(seat);
      for (const action of view.availableDayActions || []) {
        if (action.roleId && view.you.role !== action.roleId) continue; // 不主动冒用他人能力
        discussionLater.push({ kind: "dayAction", seat, action });
      }
    }

    this.dayPlan = {
      day: s.day,
      night: s.night,
      queue: [...round1, ...discussionLater],
      nominationQueue: nominationLater,
      nomQueue: this.rng.shuffle(aiSeats),
      reactBudget: humansAlive ? 2 : 6,
      humanReactUsed: new Set(),
      busy: false
    };
  }

  _tickDay() {
    const s = this.engine.state;
    if (!this.dayPlan || this.dayPlan.day !== s.day || this.dayPlan.night !== s.night) {
      this._buildDayPlan();
    }
    const plan = this.dayPlan;

    // 有人上处决台:说书人补一句氛围播报(模板,不耗 LLM)
    if (s.onBlock && s.onBlock.seat != null) {
      this._narrateTemplate(`narrate:block:${s.day}:${s.onBlock.seat}`, {
        kind: "block",
        name: s.players[s.onBlock.seat].name
      });
    }

    if (plan.busy) return;

    if (plan.queue.length) {
      const item = plan.queue.shift();
      plan.busy = true;
      (async () => {
        try {
          if (item.kind === "speak") await this._doPlannedSpeech(item);
          else if (item.kind === "whisper") await this._doPlannedWhisper(item);
          else if (item.kind === "dayAction") await this._doPlannedDayAction(item);
        } finally {
          plan.busy = false;
          if (!this.disposed) this.tick();
        }
      })();
      return;
    }

    if (plan.nominationQueue?.length && s.dayStage === "nominations") {
      const item = plan.nominationQueue.shift();
      plan.busy = true;
      (async () => {
        try {
          await this._doPlannedSpeech(item);
        } finally {
          plan.busy = false;
          if (!this.disposed) this.tick();
        }
      })();
      return;
    }

    // 有说书人主持时(人类或 AI),AI 玩家等到说书人开放提名后才考虑提名,
    // 避免讨论阶段就抢跑、投票结束后阶段被悄悄推进导致提前入夜
    const hasModerator = s.storytellerMode !== "auto";
    const nomStageOk = (st) =>
      st.phase === "day" && !st.winner &&
      (hasModerator
        ? st.dayStage === "nominations"
        : ["discussion", "whispers", "nominations"].includes(st.dayStage));
    if (plan.nomQueue.length && nomStageOk(s)) {
      // 只窥视队首,不立刻出队:延迟和 LLM 决策期间阶段可能变化(如他人提名进入投票),
      // 那种情况下这名 AI 的提名机会必须保留,等窗口回来再试,否则会被静默吞掉
      const seat = plan.nomQueue[0];
      plan.busy = true;
      (async () => {
        let consumed = false;
        try {
          await delay(this._paceGap(0.8));
          if (this.disposed) return;
          if (!nomStageOk(this.engine.state)) return; // 稍后重试,不消耗机会
          if (!this.engine.state.players[seat].alive) { consumed = true; return; }
          const ai = this.aiPlayers.get(seat);
          const nominee = await ai.decideNomination(this._viewOf(seat), this.getChatFor(seat));
          if (this.disposed) return;
          // LLM 决策耗时较长,提交前再次确认提名窗口仍然打开
          const st = this.engine.state;
          if (!nomStageOk(st)) return;
          consumed = true; // 到这里才算真正用掉这次提名机会
          if (nominee != null && st.players[seat].alive && st.players[nominee]?.alive) {
            this._say(seat, `我提名 ${st.players[nominee].name}!`, null);
            this._dispatch({ type: "nominate", nominator: seat, nominee });
          }
        } finally {
          if (consumed) {
            const i = plan.nomQueue.indexOf(seat);
            if (i !== -1) plan.nomQueue.splice(i, 1);
          }
          plan.busy = false;
          if (!this.disposed) this.tick();
        }
      })();
      return;
    }

    // 讨论与提名都结束:进入收尾节奏
    const humansAlive = this.engine.state.players.some(
      (p) => p.alive && !this.aiPlayers.has(p.seat)
    );
    const storyteller = this.getStoryteller();

    if (storyteller) {
      // AI 说书人控制节奏:讨论 → 开放提名(留出真人操作窗口) → 宣布黄昏。
      // 每一步都等场面安静(玩家持续聊天/操作会自动延长),避免打断进行中的讨论。
      if (s.dayStage === "discussion" || s.dayStage === "whispers") {
        this._once(`st:open-nom:${s.night}:${s.day}`, async () => {
          const proceed = await this._waitForLull({
            minMs: humansAlive ? 45000 : 3000,
            quietMs: humansAlive ? 18000 : 0,
            maxMs: humansAlive ? 240000 : 8000,
            valid: () => {
              const st = this.engine.state;
              return st.phase === "day" && st.day === s.day && !st.winner &&
                ["discussion", "whispers"].includes(st.dayStage);
            }
          });
          if (!proceed || this.disposed) return;
          const st = this.engine.state;
          if (st.phase === "day" && ["discussion", "whispers"].includes(st.dayStage) && st.day === s.day && !st.pendingStorytellerDecision) {
            this._dispatch({
              type: "storytellerAdvancePhase",
              stage: "nominations",
              durationMs: humansAlive ? 90000 : 6000
            });
            this._narrateTemplate(`narrate:open-nom:${s.night}:${s.day}`, { kind: "nominations-open" });
          }
        });
      } else if (s.dayStage === "nominations") {
        this._once(`st:dusk:${s.night}:${s.day}`, async () => {
          await this._waitForLull({
            minMs: humansAlive ? 90000 : 5000,
            quietMs: humansAlive ? 20000 : 0,
            maxMs: humansAlive ? 300000 : 15000,
            valid: () => {
              const st = this.engine.state;
              return st.phase === "day" && st.day === s.day && !st.winner;
            }
          });
          // 等待进行中的投票/裁定结束再宣布黄昏
          let guard = 0;
          while (!this.disposed && guard++ < 200) {
            const st = this.engine.state;
            if (st.phase !== "day" || st.day !== s.day || st.winner) return;
            if (st.dayStage !== "voting" && !st.pendingStorytellerDecision) break;
            await delay(1500);
          }
          if (this.disposed) return;
          const st = this.engine.state;
          if (st.phase === "day" && st.day === s.day && !st.winner) {
            this._dispatch({ type: "endDay" });
          }
        });
      }
      return;
    }

    // 全自动模式(无任何说书人):若存活玩家全是 AI,自动进入黄昏,防止对局卡死。
    // 人类说书人主持时不自动入夜,由控制台的"宣布黄昏"决定。
    if (!humansAlive && s.storytellerMode === "auto") {
      this._once(`dusk:${s.night}:${s.day}`, async () => {
        await delay(4000);
        if (this.disposed) return;
        const st = this.engine.state;
        if (st.phase === "day" && st.dayStage === "discussion") {
          this._dispatch({ type: "endDay" });
        }
      });
    }
  }

  /* ---------------- 计划任务执行 ---------------- */

  /** 计划中的公开发言 */
  async _doPlannedSpeech(item) {
    await delay(this._paceGap());
    if (this.disposed) return;
    const s = this.engine.state;
    if (s.phase !== "day" || !s.players[item.seat].alive) return;
    if (item.requiresNominationStage && s.dayStage !== "nominations") return;
    const quiet = await this._waitForHumanQuiet({
      quietMs: 10000,
      maxMs: 30000,
      valid: () => this.engine.state.phase === "day" && this.engine.state.players[item.seat]?.alive
    });
    if (!quiet || this.disposed) return;
    const ai = this.aiPlayers.get(item.seat);
    const text = await ai.speak(this._viewOf(item.seat), this.getChatFor(item.seat));
    if (text) {
      const id = this._say(item.seat, `【${item.round}】${text}`, null);
      this._maybeAIReact(item.seat, text, id, 1);
    }
  }

  /** 计划中的白天主动能力考虑:决定使用就按剧本配置的宣告文案公开宣告并结算 */
  async _doPlannedDayAction(item) {
    await delay(this._paceGap(0.8));
    if (this.disposed) return;
    const quiet = await this._waitForHumanQuiet({
      quietMs: 10000,
      maxMs: 30000,
      valid: () => this.engine.state.phase === "day" && this.engine.state.players[item.seat]?.alive
    });
    if (!quiet || this.disposed) return;
    const view = this._viewOf(item.seat);
    const action = (view.availableDayActions || []).find(
      (a) => a.actionType === item.action.actionType
    );
    if (!action || !view.you.alive) return;
    const ai = this.aiPlayers.get(item.seat);
    const target = await ai.decideDayAction(view, this.getChatFor(item.seat), action);
    if (target == null || this.disposed) return;
    const st = this.engine.state;
    if (st.phase !== "day" || !st.players[item.seat].alive || !st.players[target]?.alive) return;
    if (action.announceTemplate) {
      this._say(item.seat, action.announceTemplate.replace("{target}", st.players[target].name), null);
    }
    this._dispatch({ type: action.actionType, seat: item.seat, target });
  }

  /** 计划中的主动私聊(邪恶协调/社交串联);对象是 AI 时附带一轮回复 */
  async _doPlannedWhisper(item) {
    await delay(this._paceGap(0.7));
    if (this.disposed) return;
    const quiet = await this._waitForHumanQuiet({
      quietMs: 10000,
      maxMs: 30000,
      valid: () => this.engine.state.phase === "day"
    });
    if (!quiet || this.disposed) return;
    const s = this.engine.state;
    if (s.phase !== "day") return;
    const from = s.players[item.from];
    const to = s.players[item.to];
    if (!from || !to || !from.alive || !to.alive) return;
    const ai = this.aiPlayers.get(item.from);
    const text = await ai.initiateWhisper(this._viewOf(item.from), this.getChatFor(item.from), {
      seat: item.to,
      name: to.name,
      isTeammate: item.isTeammate,
      isHuman: !this.aiPlayers.has(item.to)
    });
    if (!text || this.disposed || this.engine.state.phase !== "day") return;
    this._say(item.from, text, item.to);

    const replier = this.aiPlayers.get(item.to);
    if (replier) {
      await delay(this._paceGap(0.6));
      if (this.disposed || this.engine.state.phase !== "day") return;
      const reply = await replier.replyWhisper(
        this._viewOf(item.to), this.getChatFor(item.to), from.name, text
      );
      if (reply) this._say(item.to, reply, item.from);
    }
  }

  /**
   * 一条公开消息可能引来其他 AI 的追问/回应。
   * 被点名的优先;有问号的消息更容易被接话。
   * 用每日 reactBudget 和 depth 限制,避免 AI 之间无限对话。
   */
  _maybeAIReact(fromSeat, text, chatId, depth = 1, options = {}) {
    const s = this.engine.state;
    if (this.disposed || s.phase !== "day") return;
    const plan = this.dayPlan;
    if (!plan || plan.reactBudget <= 0 || depth > 2) return;
    if (options.fromHuman && this._humansAlive()) return;

    const candidates = [...this.aiPlayers.keys()].filter(
      (seat) => seat !== fromSeat && s.players[seat].alive
    );
    if (!candidates.length) return;
    const mentioned = candidates.filter((seat) => text.includes(s.players[seat].name));

    let seat = null;
    if (mentioned.length) seat = this.rng.pick(mentioned);
    else if ((text.includes("?") || text.includes("？")) && this.rng.chance(0.4)) seat = this.rng.pick(candidates);
    else if (this.rng.chance(0.12)) seat = this.rng.pick(candidates);
    if (seat == null) return;
    if (!this.rng.chance(0.35 + 0.55 * this._traitsOf(seat).talk)) return;

    plan.reactBudget--;
    this._once(`aireact:${chatId}:${seat}`, async () => {
      await delay(this._paceGap(0.9));
      const quiet = await this._waitForHumanQuiet({
        quietMs: 10000,
        maxMs: 30000,
        valid: () => this.engine.state.phase === "day"
      });
      if (!quiet || this.disposed || this.engine.state.phase !== "day") return;
      const ai = this.aiPlayers.get(seat);
      const reply = await ai.speak(this._viewOf(seat), this.getChatFor(seat));
      if (reply) {
        const id = this._say(seat, reply, null);
        this._maybeAIReact(seat, reply, id, depth + 1);
      }
    });
  }

  /** 说书人模板播报(不耗 LLM 额度) */
  _narrateTemplate(key, event) {
    const storyteller = this.getStoryteller();
    if (!storyteller) return;
    this._once(key, async () => {
      const text = await storyteller.narrate(this.getStorytellerView(), event);
      if (text && !this.disposed && !this.engine.state.winner) {
        this._dispatch({ type: "storytellerNarrate", text });
      }
    });
  }

  /* ---------------- 对话反应 ---------------- */

  /** 真人发公开消息后,可能有 AI 回应。chatId 保证同一条消息只触发一次。 */
  onHumanChat(fromSeat, text, chatId) {
    const s = this.engine.state;
    if (s.phase !== "day" || this.disposed) return;
    this.lastMsgLen = text.length;
    this.lastHumanActivityAt = Date.now();
    const mentioned = [...this.aiPlayers.keys()].filter(
      (seat) => s.players[seat].alive && text.includes(s.players[seat].name)
    );
    const isQuestion = text.includes("?") || text.includes("？");
    const isClaim = /我是|身份|查了|查的|查到|得知|信息|提名|投|恶魔|爪牙|好人|邪恶/.test(text);
    const shouldReply =
      mentioned.length > 0 ||
      (isQuestion && this.rng.chance(0.7)) ||
      (isClaim && this.rng.chance(0.75)) ||
      this.rng.chance(0.2);
    if (!shouldReply) return;
    const pool = mentioned.length
      ? mentioned
      : [...this.aiPlayers.keys()].filter((seat) => s.players[seat].alive);
    if (!pool.length) return;
    const seat = this.rng.pick(pool);
    if (this.dayPlan?.humanReactUsed?.has(chatId)) return;
    this.dayPlan?.humanReactUsed?.add(chatId);

    this._once(`react:${chatId != null ? chatId : Date.now()}`, async () => {
      await delay(this._paceGap(0.9));
      const quiet = await this._waitForHumanQuiet({
        quietMs: 10000,
        maxMs: 30000,
        valid: () => this.engine.state.phase === "day"
      });
      if (!quiet || this.disposed || this.engine.state.phase !== "day") return;
      const ai = this.aiPlayers.get(seat);
      const reply = await ai.speak(this._viewOf(seat), this.getChatFor(seat));
      if (reply) this._say(seat, reply, null);
    });
  }

  /** 真人私聊 AI,AI 回复 */
  onWhisper(fromSeat, toSeat, text, chatId) {
    const ai = this.aiPlayers.get(toSeat);
    if (!ai || this.disposed) return;
    this.lastMsgLen = text.length;
    this.lastHumanActivityAt = Date.now();
    const fromName = this.engine.state.players[fromSeat].name;
    this._once(`whisper:${chatId != null ? chatId : Date.now()}`, async () => {
      await delay(this._paceGap(0.7));
      const quiet = await this._waitForHumanQuiet({
        quietMs: 10000,
        maxMs: 30000,
        valid: () => this.engine.state.phase === "day"
      });
      if (!quiet || this.disposed) return;
      const reply = await ai.replyWhisper(
        this._viewOf(toSeat), this.getChatFor(toSeat), fromName, text
      );
      if (reply) this._say(toSeat, reply, fromSeat);
    });
  }
}
