// Observe the real allocations: throwing without returning bytes does not prove cleanup.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoundedFile } from "../src/cli/bounded-read.js";
import { readInputTextFile } from "../src/cli/text-file.js";

const edge = vi.hoisted<{
  readError: Error | undefined;
  closeError: Error | undefined;
  chunks: Buffer[];
  closed: number;
}>(() => ({
  readError: undefined,
  closeError: undefined,
  chunks: [],
  closed: 0,
}));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    readSync: (
      descriptor: number,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number | null,
    ): number => {
      edge.chunks.push(buffer);
      if (edge.readError !== undefined) {
        buffer.fill(0x51);
        throw edge.readError;
      }
      return real.readSync(descriptor, buffer, offset, length, position);
    },
    closeSync: (descriptor: number): void => {
      real.closeSync(descriptor);
      edge.closed += 1;
      if (edge.closeError !== undefined) throw edge.closeError;
    },
  };
});

const PUBLIC_TEXT = "PUBLIC bounded file bytes";
const LIMIT = 128;
let directory: string;
let path: string;

beforeEach(() => {
  edge.readError = undefined;
  edge.closeError = undefined;
  edge.chunks = [];
  edge.closed = 0;
  directory = mkdtempSync(join(tmpdir(), "mnemocode-bounded-lifetime-"));
  path = join(directory, "public.txt");
  writeFileSync(path, PUBLIC_TEXT, { mode: 0o600 });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const bytes of edge.chunks) bytes.fill(0);
  rmSync(directory, { recursive: true, force: true });
});

it("transfers a successful result live while retiring the actual read chunks", () => {
  const result = readBoundedFile(path, LIMIT, "Public fixture");
  try {
    expect(result.toString("utf8")).toBe(PUBLIC_TEXT);
    expect(edge.closed).toBe(1);
    expect(edge.chunks.length).toBeGreaterThan(0);
    for (const bytes of edge.chunks) expect(bytes.every((byte) => byte === 0)).toBe(true);
  } finally {
    result.fill(0);
  }
});

it.each([
  ["only close fails", false, true],
  ["only read fails", true, false],
  ["read and close both fail", true, true],
] as const)(
  "retires untransferred bytes and preserves error identity when %s",
  (_, read, close) => {
    const readError = new Error("Synthetic OS read failure.");
    const closeError = Object.assign(new Error("Synthetic OS close failure."), { code: "EIO" });
    edge.readError = read ? readError : undefined;
    edge.closeError = close ? closeError : undefined;
    const allocations = vi.spyOn(Buffer, "concat");
    try {
      let failed: unknown;
      try {
        readBoundedFile(path, LIMIT, "Public fixture");
      } catch (error) {
        failed = error;
      }
      expect(failed).toBe(close ? closeError : readError);
      expect(edge.closed).toBe(1);
      expect(allocations.mock.results).toHaveLength(read ? 0 : 1);
      for (const result of allocations.mock.results) {
        if (result.type !== "return") throw new Error("The real allocation must return bytes.");
        expect(result.value.every((byte) => byte === 0)).toBe(true);
      }
      for (const bytes of edge.chunks) expect(bytes.every((byte) => byte === 0)).toBe(true);
    } finally {
      for (const result of allocations.mock.results)
        if (result.type === "return") result.value.fill(0);
    }
  },
);

it("keeps the safe text-input refusal and its cause after retiring an unreturned result", () => {
  const error = Object.assign(new Error("Synthetic OS close failure."), { code: "EIO" });
  edge.closeError = error;
  const allocations = vi.spyOn(Buffer, "concat");
  try {
    expect(() => readInputTextFile(path)).toThrow(
      expect.objectContaining({ code: "cli.bounded-read.read-file-refuse-refused", cause: error }),
    );
    expect(edge.closed).toBe(1);
    expect(allocations.mock.results).toHaveLength(1);
    for (const result of allocations.mock.results) {
      if (result.type !== "return") throw new Error("The real allocation must return bytes.");
      expect(result.value.every((byte) => byte === 0)).toBe(true);
    }
  } finally {
    for (const result of allocations.mock.results)
      if (result.type === "return") result.value.fill(0);
  }
});
