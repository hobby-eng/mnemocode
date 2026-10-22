import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runEncode } from "../src/cli/encode-command.js";
import { ENCODED_FORMATS } from "../src/core/types.js";
import { terminal } from "./helpers/keyed-terminal.js";
import { PrivateTerminal } from "./helpers/private-terminal.js";
import { Screen } from "./helpers/terminal-screen.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";
import { DATE, TEST_PHRASE } from "./helpers/test-phrase.js";
import { BACKUP_CHECK_QUESTION } from "./helpers/prompts.js";
import { ENTER } from "./helpers/keys.js";

const harness = await vi.hoisted(async () => import("./helpers/keyed-terminal.js"));
vi.mock("../src/cli/terminal-input.js", async (original) =>
  harness.replacedTerminalInput(await original()),
);

let folder: string;
let view: PrivateTerminal;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "mnemocode-visible-"));
  await writeFile(join(folder, "phrase.txt"), TEST_PHRASE);
  await writeFile(join(folder, "dates.txt"), DATE);
  streamsAsTerminal();
  vi.stubEnv("NO_COLOR", "1");
  view = new PrivateTerminal(80, 24);
  terminal.asked = [];
  terminal.atTerminal = true;
});
afterEach(async () => {
  view.close();
  await rm(folder, { recursive: true, force: true });
});

const cases = ENCODED_FORMATS.flatMap((format) =>
  (["direct", "seedshift", "seedshift-legacy"] as const).flatMap((mode) =>
    format === "english" && mode === "direct"
      ? []
      : (["screen", "record", "qr", "all"] as const).map((destination) => ({
          format,
          mode,
          destination,
        })),
  ),
);

describe("the result above the backup-check question", () => {
  it.each(cases)(
    "keeps $mode/$format visible above the check after saves to $destination",
    async ({ format, mode, destination }) => {
      let asked = false;
      terminal.keysFor = () => {
        if (terminal.asked.at(-1)?.question !== BACKUP_CHECK_QUESTION) return ENTER;
        asked = true;
        const screen = new Screen(80, 24);
        screen.write(view.written);
        expect(screen.lines().join("\n")).toContain("Encoded result");
        expect(screen.lines().join("\n")).toContain(BACKUP_CHECK_QUESTION);
        return "2";
      };
      await runEncode({
        mode,
        format,
        "mnemonic-file": join(folder, "phrase.txt"),
        ...(mode === "direct" ? {} : { "dates-file": join(folder, "dates.txt") }),
        ...(destination === "record" || destination === "all"
          ? { output: join(folder, "record.txt") }
          : {}),
        ...(destination === "qr" || destination === "all" ? { qr: join(folder, "qr.png") } : {}),
        ...(destination === "all" && mode !== "seedshift-legacy"
          ? { "heir-sheet": join(folder, "heirs.pdf") }
          : {}),
      });
      expect(asked).toBe(true);
      const written = view.written;
      expect(written).not.toContain("BIP32 fingerprints above use an empty BIP39 passphrase.");
      expect(written).not.toContain("They do not reveal the phrase.");
      if (mode === "seedshift-legacy") {
        const link = written.indexOf(
          "More: https://github.com/hobby-eng/mnemocode#transformation-modes",
        );
        expect(link).toBeGreaterThanOrEqual(0);
        expect(link).toBeLessThan(written.indexOf("Encoded result"));
      }
      if (destination === "record" || destination === "all")
        expect(
          (await readFile(join(folder, "record.txt"), "utf8")).trim().split("\n"),
        ).toHaveLength(1);
    },
  );
});
