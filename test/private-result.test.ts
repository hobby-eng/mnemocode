import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { PrivateResult } from "../src/cli/private-result.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { displayWidth } from "../src/cli/terminal-geometry.js";
import { printShares, inForm } from "../src/cli/sskr-output.js";
import { SHARE_FORMATS } from "../src/sskr/transport.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";

const keyboard = vi.hoisted(() => ({ bytes: [] as number[] }));
vi.mock("../src/cli/terminal-input.js", async (original) => ({
  ...(await original<typeof import("../src/cli/terminal-input.js")>()),
  dropTypedAhead: async () => undefined,
  withRawTerminal: async <T>(
    body: (next: () => Promise<number | undefined>, more: () => Promise<boolean>) => Promise<T>,
  ) =>
    body(
      async () => keyboard.bytes.shift(),
      async () => keyboard.bytes.length > 0,
    ),
}));

const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
const columns = process.stderr.columns;
const rows = process.stderr.rows;
let frames: string[];

beforeEach(() => {
  frames = [];
  process.stderr.columns = 80;
  process.stderr.rows = 24;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  PrivateSteps.open(() => undefined);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    frames.push(String(line));
  });
});
afterEach(() => {
  PrivateSteps.close();
  vi.restoreAllMocks();
  process.stderr.columns = columns;
  process.stderr.rows = rows;
  if (stdoutTty === undefined) Reflect.deleteProperty(process.stdout, "isTTY");
  else Object.defineProperty(process.stdout, "isTTY", stdoutTty);
});

function type(keys: string): void {
  keyboard.bytes = Array.from(Buffer.from(keys));
}

describe("finite private result pages", () => {
  it("keeps the admitted lines independent from later changes to the caller's array", async () => {
    const lines = ["Initial public row", ...Array.from({ length: 40 }, () => "Public fixture")];
    using result = new PrivateResult(lines);
    lines[0] = "Changed public row";
    type("\r");
    await result.show(vi.fn());
    expect(frames[0]).toContain("Initial public row");
    expect(frames[0]).not.toContain("Changed public row");
  });

  it("refuses a private or plain replay after disposal", async () => {
    const result = new PrivateResult(["Public fixture"]);
    result.wipe();
    result[Symbol.dispose]();
    const plain = vi.fn();
    await expect(result.show(plain)).rejects.toHaveProperty("code", "core.secret-value.wiped");
    expect(plain).not.toHaveBeenCalled();
  });

  it.each(["\r", "\x03", "\x1b"])(
    "disposes the share display after its final key (%j)",
    async (key) => {
      type(key);
      const wipe = vi.spyOn(PrivateResult.prototype, "wipe");
      const shares = Array.from({ length: 16 }, () => sskrSetVector.shares[0]);
      await printShares(inForm(shares, SHARE_FORMATS[0]!));
      expect(wipe).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [80, 24],
    [32, 12],
    [120, 40],
  ])("keeps every row reachable in a %i by %i viewport", async (width, height) => {
    process.stderr.columns = width;
    process.stderr.rows = height;
    const lines = Array.from({ length: 85 }, (_, i) => `Public row ${i}`);
    type("\x1b[6~".repeat(100) + "\x1b[H\x1b[F\x1b[5~\x1b[A\x1b[B\r");
    const plain = vi.fn();
    expect(await new PrivateResult(lines).show(plain)).toBeUndefined();
    expect(plain).not.toHaveBeenCalled();
    for (const line of lines)
      expect(frames.some((frame) => frame.split("\n").includes(line))).toBe(true);
    for (const frame of frames) {
      expect(
        frame
          .split("\n")
          .reduce((n, line) => n + Math.max(1, Math.ceil(displayWidth(line) / width)), 1),
      ).toBeLessThanOrEqual(height);
    }
    expect(frames.at(-1)).toContain("Page");
    expect(frames.some((frame, i) => i > 0 && frame.includes("Public row 0"))).toBe(true);
  });

  it.each(SHARE_FORMATS)(
    "shows every long share in %s without losing its first page",
    async (format) => {
      process.stderr.rows = 12;
      type("\x1b[6~".repeat(120) + "\x1b[H\r");
      const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const shares = Array.from({ length: 16 }, (_, i) => sskrSetVector.shares[i % 3]!);
      expect(await printShares(inForm(shares, format))).toBeUndefined();
      for (let i = 1; i <= shares.length; i++)
        expect(frames.join("\n")).toContain(`SSKR share ${i} of 16`);
      expect(frames.at(-1)).toContain("SSKR share 1 of 16");
      expect(output).not.toHaveBeenCalled();
    },
  );

  it.each(["\x03", "\x1b"])(
    "cancels without continuing and releases resize listeners (%j)",
    async (key) => {
      type(key);
      const count = process.listenerCount("SIGWINCH");
      expect(await new PrivateResult(Array(40).fill("Public fixture")).show(vi.fn())).toBe(
        CANCELLED,
      );
      expect(process.listenerCount("SIGWINCH")).toBe(count);
    },
  );

  it("keeps complete redirected and short output through its original writer", async () => {
    const plain = vi.fn();
    await new PrivateResult(["Short result"]).show(plain);
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    await new PrivateResult(Array(100).fill("Public fixture")).show(plain);
    expect(plain).toHaveBeenCalledTimes(2);
    expect(frames).toEqual([]);
  });

  it("reflows the current page when the terminal is resized while waiting", async () => {
    const first = "First public row";
    const lines = [
      first,
      ...Array.from({ length: 40 }, (_, i) => `Public wide row ${i} ${"的".repeat(30)}`),
    ];
    type("\r");
    let resized = false;
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      frames.push(String(line));
      if (resized) return;
      resized = true;
      process.stderr.columns = 32;
      process.stderr.rows = 12;
      process.emit("SIGWINCH");
    });
    await new PrivateResult(lines).show(vi.fn());
    expect(frames).toHaveLength(2);
    expect(frames[1]).toContain(first);
    const linesOnScreen = frames[1]!.split("\n");
    const footer = linesOnScreen.findIndex((line) => line.startsWith("Page "));
    expect(linesOnScreen.slice(0, footer).every((line) => displayWidth(line) <= 32)).toBe(true);
    expect(
      linesOnScreen.reduce(
        (count, line) => count + Math.max(1, Math.ceil(displayWidth(line) / 32)),
        1,
      ),
    ).toBeLessThanOrEqual(12);
  });
});
