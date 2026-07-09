import { afterEach, describe, expect, it, vi } from "vitest";
import { AIDebugLogger } from "../src/ai/debugLogger.js";

describe("AI debug logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.fetch;
  });

  it("does nothing when disabled", async () => {
    const fetch = vi.fn();
    globalThis.fetch = fetch;
    const logger = new AIDebugLogger({ enabled: false, gameId: "game-a" });

    await logger.record({ actor: "ai-player", input: "hello", output: "world" });

    expect(fetch).not.toHaveBeenCalled();
    expect(logger.seq).toBe(0);
  });

  it("posts AI input and output as one debug row", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetch;
    const logger = new AIDebugLogger({ enabled: true, gameId: "game-b", endpoint: "/debug" });

    await logger.record({
      actor: "ai-player",
      seat: 2,
      phase: "day:discussion:N1:D1",
      task: "speech",
      input: [{ role: "user", content: "say something" }],
      output: "{\"speech\":\"hi\"}"
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/debug", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }));
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload).toMatchObject({
      gameId: "game-b",
      seq: 1,
      actor: "ai-player",
      seat: 2,
      phase: "day:discussion:N1:D1",
      task: "speech",
      output: "{\"speech\":\"hi\"}",
      error: ""
    });
    expect(payload.input).toContain("say something");
    expect(payload.ts).toEqual(expect.any(String));
  });

  it("keeps sequence numbers and truncates oversized fields", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetch;
    const logger = new AIDebugLogger({ enabled: true, gameId: "game-c" });

    await logger.record({ task: "first", input: "x".repeat(21000), output: "ok" });
    await logger.record({ task: "second", input: "next", output: "ok" });

    const first = JSON.parse(fetch.mock.calls[0][1].body);
    const second = JSON.parse(fetch.mock.calls[1][1].body);
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.input).toHaveLength(20014);
    expect(first.input.endsWith("...[truncated]")).toBe(true);
  });
});
