// A name typed after a failed save, in a folder that a cloud service copies, is warned of only once
// the result is saved there (save-retry.ts): a warning kept for the rest of the command must be
// about a file that is saved.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveWithRetry } from "../src/cli/save-retry.js";
import { PrivateSteps } from "../src/cli/private-steps.js";

const keyboard = vi.hoisted(() => ({ bytes: [] as number[] }));
vi.mock("node:tty", async (original) => ({
  ...(await original<typeof import("node:tty")>()),
  isatty: (descriptor: number) => descriptor === 0 || descriptor === 2,
}));
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

let output: string[];
const typed = (text: string): number[] => [...Buffer.from(text, "utf8")];
beforeEach(() => {
  output = [];
  vi.stubEnv("NO_COLOR", "1");
  vi.stubEnv("TERM", "xterm");
  for (const stream of [process.stdin, process.stdout, process.stderr])
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
  vi.spyOn(process.stderr, "write").mockImplementation((text) => (output.push(String(text)), true));
  vi.spyOn(console, "error").mockImplementation((line: unknown) => output.push(String(line)));
});
afterEach(() => {
  PrivateSteps.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("warns of a cloud copy of another name only once saved there", async () => {
  PrivateSteps.open(
    () => undefined,
    () => undefined,
  );
  const written: string[] = [];
  let failures = 2;
  const cloud = "/public/Dropbox/other.txt";
  const marks: number[] = [];
  // Fails at the given name, then at the other name; "Try again" saves it.
  keyboard.bytes = [0x32, ...typed(cloud), 0x0d, 0x31];
  const saved = await saveWithRetry({
    what: "The record",
    kind: "file",
    path: "public.txt",
    write: async (path) => {
      written.push(path);
      marks.push(output.join("").split("Dropbox keeps a copy").length - 1);
      if (failures-- > 0) throw Object.assign(new Error("Synthetic."), { code: "EACCES" });
    },
    checkName: async () => undefined,
  });
  expect(saved).toBe(cloud);
  expect(written).toEqual(["public.txt", cloud, cloud]);
  // No warning before any write, nor after the failed one; one after the save.
  expect(marks).toEqual([0, 0, 0]);
  expect(output.join("").split("Dropbox keeps a copy").length - 1).toBe(1);
});
