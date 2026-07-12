const DEFAULT_ENDPOINT = "/api/debug/ai-log";

function compact(value, max = 20000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text;
}

export class AIDebugLogger {
  constructor({ enabled = false, gameId = null, endpoint = DEFAULT_ENDPOINT } = {}) {
    this.enabled = !!enabled;
    this.gameId = gameId || `game-${Date.now()}`;
    this.endpoint = endpoint;
    this.seq = 0;
  }

  async record(entry) {
    if (!this.enabled) return;
    const payload = {
      gameId: this.gameId,
      seq: ++this.seq,
      ts: new Date().toISOString(),
      actor: entry.actor || "",
      seat: entry.seat ?? "",
      phase: entry.phase || "",
      task: entry.task || "",
      input: compact(entry.input),
      output: compact(entry.output),
      // token 用量与 thinking 探测(input/output/cache 四项 + 非text块类型),用于成本统计与 maxTokens 校准
      usage: entry.usage || null,
      error: compact(entry.error || "", 4000)
    };

    try {
      await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      if (!this._warned) {
        this._warned = true;
        console.warn("AI debug log write failed; continuing without file logging.", error.message);
      }
    }
  }
}