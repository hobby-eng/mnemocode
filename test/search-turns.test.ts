import { describe, expect, it, vi } from "vitest";
import { SearchTurns, startTimer, TURN_MILLISECONDS } from "../src/core/search-turns.js";

describe("Search timing supplied by the host", () => {
  it("measures seconds with the same monotonic clock at both ends", () => {
    let milliseconds = 100;
    const elapsed = startTimer(() => milliseconds);
    milliseconds += 250;
    expect(elapsed()).toBe(0.25);
    milliseconds += 750;
    expect(elapsed()).toBe(1);
  });

  it("yields at the clock boundary and starts the next interval after the host returns", async () => {
    let milliseconds = 0;
    const turn = vi.fn(async () => {
      milliseconds += 1_000;
    });
    const turns = SearchTurns.of({ now: () => milliseconds, turn });
    milliseconds = TURN_MILLISECONDS - 1;
    expect(await turns.due()).toBe("running");
    milliseconds += 1;
    expect(await turns.due()).toBe("turned");
    expect(turn).toHaveBeenCalledTimes(1);
    expect(await turns.due()).toBe("running");
    milliseconds += TURN_MILLISECONDS;
    expect(await turns.due()).toBe("turned");
    expect(turn).toHaveBeenCalledTimes(2);
  });

  it("stops before consulting the clock or running the host after cancellation", async () => {
    const controller = new AbortController();
    const now = vi.fn(() => 0);
    const turn = vi.fn(async () => {});
    const turns = SearchTurns.of({ now, turn, signal: controller.signal });
    const readsAtStart = now.mock.calls.length;
    controller.abort();
    expect(await turns.due()).toBe("stopped");
    expect(await turns.take()).toBe("stopped");
    expect(turn).not.toHaveBeenCalled();
    expect(now).toHaveBeenCalledTimes(readsAtStart);
  });
});
