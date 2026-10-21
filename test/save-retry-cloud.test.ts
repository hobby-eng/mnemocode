// A name typed after a failed save, in a folder that a cloud service copies, is warned of only once
// the result is saved there (save-retry.ts): a warning kept for the rest of the command must be
// about a file that is saved.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveWithRetry } from "../src/cli/save-retry.js";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { preflightFileDestination } from "../src/cli/output-paths.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";

vi.mock("node:tty", async (original) => ({
  ...(await original<typeof import("node:tty")>()),
  isatty: (descriptor: number) => descriptor === 0 || descriptor === 2,
}));
const typing = await vi.hoisted(async () => import("./helpers/typed-keys.js"));
vi.mock("../src/cli/terminal-input.js", async (original) =>
  typing.replacedTerminalInput(await original()),
);
const { keyboard } = typing;

let output: string[];
let directory: string;
const typed = (text: string): number[] => [...Buffer.from(text, "utf8")];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mnemocode-save-retry-"));
  await mkdir(join(directory, "Dropbox"));
  output = [];
  vi.stubEnv("NO_COLOR", "1");
  vi.stubEnv("TERM", "xterm");
  streamsAsTerminal();
  vi.spyOn(process.stderr, "write").mockImplementation((text) => (output.push(String(text)), true));
  vi.spyOn(console, "error").mockImplementation((line: unknown) => output.push(String(line)));
});
afterEach(async () => {
  PrivateSteps.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

it("warns of a cloud copy of another name only once saved there", async () => {
  PrivateSteps.open(
    () => undefined,
    () => undefined,
  );
  const written: string[] = [];
  let failures = 2;
  const cloud = join(directory, "Dropbox", "other.txt");
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
    checkName: (path) => preflightFileDestination(path, false),
  });
  expect(saved).toBe(cloud);
  expect(written).toEqual(["public.txt", cloud, cloud]);
  // No warning before any write, nor after the failed one; one after the save.
  expect(marks).toEqual([0, 0, 0]);
  expect(output.join("").split("Dropbox keeps a copy").length - 1).toBe(1);
});
