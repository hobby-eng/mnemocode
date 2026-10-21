// Why a save failed is the warning of its step on the private screen (save-retry.ts, CORE-39): it
// is shown with "What now?", and once another try saved the result, no later step screen shows it,
// also when the save came first on its page, before any question, as sskr-split's with
// --mnemonic-file does. The terminal is replaced at node:tty and terminal-input.ts; the failure is
// the file system's, at the write.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearPrivateScreen } from "../src/cli/private-screen.js";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { saveWithRetry, type Saving } from "../src/cli/save-retry.js";
import { CLEAR_SCREEN } from "../src/cli/terminal.js";

vi.mock("node:tty", async (original) => ({
  ...(await original<typeof import("node:tty")>()),
  isatty: (descriptor: number) => descriptor === 0 || descriptor === 2,
}));
const typing = await vi.hoisted(async () => import("./helpers/typed-keys.js"));
vi.mock("../src/cli/terminal-input.js", async (original) =>
  typing.replacedTerminalInput(await original()),
);
const { keyboard } = typing;

const FAILURE = "The record could not be saved as public.txt: the disk is full.";

/** The record, whose first `failures` writes find the disk full. */
function failingRecord(failures: number): Saving {
  let left = failures;
  return {
    what: "The record",
    kind: "file",
    path: "public.txt",
    write: async () => {
      if (left-- > 0) throw Object.assign(new Error("Synthetic."), { code: "ENOSPC" });
    },
    checkName: async () => undefined,
  };
}

let drawn: string[];
let written: string[];
beforeEach(() => {
  vi.stubEnv("NO_COLOR", "1");
  vi.stubEnv("TERM", "xterm");
  for (const stream of [process.stdin, process.stdout, process.stderr])
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
  written = [];
  vi.spyOn(process.stderr, "write").mockImplementation(
    (text) => (written.push(String(text)), true),
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  drawn = [];
  PrivateSteps.open(
    () => drawn.push("title"),
    (warning) => drawn.push(`! ${warning}`),
  );
});
afterEach(() => {
  PrivateSteps.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("shows why a save failed with What now?, and on no step screen once another try saved it", async () => {
  // The result's page, opened before its saves.
  clearPrivateScreen();
  // "Try again", by its digit.
  keyboard.bytes = [0x31];
  expect(await saveWithRetry(failingRecord(1))).toBe("public.txt");
  expect(drawn).toEqual(["title", `! ${FAILURE}`]);
  // The page goes on, after another try, on a screen cleared of the failure and its question.
  const asked = written.findIndex((text) => text.includes("What now?"));
  expect(asked).toBeGreaterThan(0);
  expect(written.slice(asked).some((text) => text.includes(CLEAR_SCREEN))).toBe(true);
  // The next step, such as the backup check's prompt.
  PrivateSteps.begin();
  expect(drawn.slice(2)).toEqual(["title"]);
});

it("shows why a save failed until it is skipped, then that it was not saved", async () => {
  clearPrivateScreen();
  // "Skip", by its digit.
  keyboard.bytes = [0x33];
  expect(await saveWithRetry(failingRecord(1))).toBeUndefined();
  PrivateSteps.begin();
  expect(drawn).toEqual(["title", `! ${FAILURE}`, "title", "! The record was not saved."]);
});
