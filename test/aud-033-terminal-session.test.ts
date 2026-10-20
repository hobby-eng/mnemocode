import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { TEST_TIME_LIMIT_MS } from "./helpers/limits.js";

it("distinguishes expected PTY EOF and races from real read and descriptor-check failures", () => {
  expect(() =>
    execFileSync("python3", ["-B", "scripts/terminal-session-errors.py"], {
      timeout: TEST_TIME_LIMIT_MS,
      stdio: "pipe",
    }),
  ).not.toThrow();
});
