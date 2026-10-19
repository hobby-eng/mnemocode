import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("distinguishes expected PTY EOF and races from real read and descriptor-check failures", () => {
  expect(() =>
    execFileSync("python3", ["-B", "scripts/terminal-session-errors.py"], {
      timeout: 10_000,
      stdio: "pipe",
    }),
  ).not.toThrow();
});
