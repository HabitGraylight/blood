/**
 * AI 驱动器:在引擎所在端(单机客户端/联机房主端)调度 AI 玩家行动。
 * - 夜晚:轮到 AI 的行动时自动决策
 * - 白天:按计划让 AI 依次发言、考虑提名
 * - 投票:轮到 AI 时自动表决
 * - 私聊:AI 收到耳语后回复
 * 所有决策都是异步的(可能走 LLM),用 key 去重防止重复调度。
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
    this.scheduled = new Set(); // 已调度任务的 key
    this.dayPlan = null; // { day, speakQueue, nomQueue, busy }
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
  }

  _viewOf(seat) {
    return playerView(this.engine.state, seat);
  }

  _dispatch(action) {
    if (this.disposed || this.engine.state.winner) return;
    const res = this.engine.dispatch(action);
    if (!res.ok) console.warn("AI 动作被拒绝:", action, res.error);
    this.onChange();
    this.tick();
  }

  /** 每次状态变化后调用,推进 AI 行动 */
  tick() {
    if (this.disposed) return;
    const s = this.engine.state;
    if (s.winner) return;

    if (s.phase === "night") this._tickNight();
    else if (s.dayStage === "voting") this._tickVote();
    else if (s.phase === "day") this._tickDay();
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
      await delay(700 + this.rng.int(1200));
      if (this.disposed) return;
      const up = await ai.decideVote(this._viewOf(voter), this.getChatFor(voter));
      this._dispatch({ type: "vote", seat: voter, up });
    });
  }

  /* ---------------- 白天:发言与提名 ---------------- */

  _tickDay() {
    const s = this.engine.state;
    if (!this.dayPlan || this.dayPlan.day !== s.day || this.dayPlan.night !== s.night) {
      const aiSeats = [...this.aiPlayers.keys()].filter((seat) => s.players[seat].alive);
      this.dayPlan = {
        day: s.day,
        night: s.night,
        speakQueue: this.rng.shuffle(aiSeats),
        nomQueue: this.rng.shuffle(aiSeats),
        busy: false
      };
    }
    const plan = this.dayPlan;
    if (plan.busy) return;

    if (plan.speakQueue.length) {
      const seat = plan.speakQueue.shift();
      plan.busy = true;
      (async () => {
        await delay(1200 + this.rng.int(2200));
        if (this.disposed) return;
        if (this.engine.state.phase === "day" && this.engine.state.players[seat].alive) {
          const ai = this.aiPlayers.get(seat);
          const text = await ai.speak(this._viewOf(seat), this.getChatFor(seat));
          if (text) this.pushChat(seat, text, null);
        }
        plan.busy = false;
        this.tick();
      })();
      return;
    }

    if (plan.nomQueue.length) {
      const seat = plan.nomQueue.shift();
      plan.busy = true;
      (async () => {
        await delay(1000 + this.rng.int(2000));
        if (this.disposed) return;
        const st = this.engine.state;
        if (st.phase === "day" && st.dayStage === "discussion" && st.players[seat].alive) {
          const ai = this.aiPlayers.get(seat);
          const nominee = await ai.decideNomination(this._viewOf(seat), this.getChatFor(seat));
          if (nominee != null) {
            this.pushChat(seat, `我提名 ${st.players[nominee].name}!`, null);
            plan.busy = false;
            this._dispatch({ type: "nominate", nominator: seat, nominee });
            return;
          }
        }
        plan.busy = false;
        this.tick();
      })();
      return;
    }

    // 讨论与提名都结束:若存活玩家全是 AI,自动进入黄昏,防止对局卡死
    const humansAlive = this.engine.state.players.some(
      (p) => p.alive && !this.aiPlayers.has(p.seat)
    );
    if (!humansAlive) {
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

  /* ---------------- 对话反应 ---------------- */

  /** 真人发公开消息后,可能有一个 AI 回应 */
  onHumanChat(fromSeat, text) {
    const s = this.engine.state;
    if (s.phase !== "day" || this.disposed) return;
    const mentioned = [...this.aiPlayers.keys()].filter(
      (seat) => s.players[seat].alive && text.includes(s.players[seat].name)
    );
    const shouldReply = mentioned.length > 0 || (text.includes("?") || text.includes("?")) && this.rng.chance(0.7);
    if (!shouldReply) return;
    const pool = mentioned.length
      ? mentioned
      : [...this.aiPlayers.keys()].filter((seat) => s.players[seat].alive);
    if (!pool.length) return;
    const seat = this.rng.pick(pool);

    this._once(`react:${Date.now()}:${seat}`, async () => {
      await delay(1500 + this.rng.int(2500));
      if (this.disposed || this.engine.state.phase !== "day") return;
      const ai = this.aiPlayers.get(seat);
      const reply = await ai.speak(this._viewOf(seat), this.getChatFor(seat));
      if (reply) this.pushChat(seat, reply, null);
    });
  }

  /** 真人私聊 AI,AI 回复 */
  onWhisper(fromSeat, toSeat, text) {
    const ai = this.aiPlayers.get(toSeat);
    if (!ai || this.disposed) return;
    const fromName = this.engine.state.players[fromSeat].name;
    this._once(`whisper:${Date.now()}:${toSeat}`, async () => {
      await delay(1200 + this.rng.int(2000));
      if (this.disposed) return;
      const reply = await ai.replyWhisper(
        this._viewOf(toSeat), this.getChatFor(toSeat), fromName, text
      );
      if (reply) this.pushChat(toSeat, reply, fromSeat);
    });
  }
}
