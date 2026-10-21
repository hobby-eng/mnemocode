import { afterAll, expect, it, vi } from "vitest";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";

const originalTerm = process.env.TERM;
const originalStdout = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const originalStderr = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");

afterAll(() => {
  expect(process.env.TERM).toBe(originalTerm);
  expect(Object.getOwnPropertyDescriptor(process.stdout, "isTTY")).toEqual(originalStdout);
  expect(Object.getOwnPropertyDescriptor(process.stderr, "isTTY")).toEqual(originalStderr);
});

it("gives layout tests a redraw-capable terminal and restores the original streams and environment", () => {
  vi.stubEnv("TERM", "dumb");
  streamsAsTerminal();
  expect(process.env.TERM).toBe("xterm");
  expect(process.stdout.isTTY).toBe(true);
  expect(process.stderr.isTTY).toBe(true);
});
