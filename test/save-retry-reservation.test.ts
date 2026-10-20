// A save on the private screen that fails and cannot remove the name it reserved, nor perhaps its
// staging folder (FailedSaveLeftReservationError): the person reads why it failed in plain words,
// then each file or folder left behind to delete, one line each (save-retry.ts). Faults come from
// the file system only; the saves are the real ones. Public test data only.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
/** The paths, by prefix, whose removal fails as a busy file system's does. */
const faults = vi.hoisted((): { stuck: string[] } => ({ stuck: [] }));
vi.mock("node:tty", async (original) => harness.replacedTty(await original()));
vi.mock("../src/cli/private-screen.js", async (original) =>
  harness.replacedPrivateScreen(await original()),
);
vi.mock("../src/cli/terminal-input.js", async (original) =>
  harness.replacedTerminalInput(await original()),
);
vi.mock("../src/cli/terminal-choice.js", async (original) =>
  harness.replacedTerminalChoice(await original()),
);
// The files are the program's edge: a file system without hard links, where a file is published
// by reserving its name and renaming the finished file into it; every rename finds the disk full,
// and the removal of the paths in `faults.stuck` fails.
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  const coded = (code: string) => Object.assign(new Error(`Synthetic ${code} fault.`), { code });
  return {
    ...real,
    link: async () => {
      throw coded("EPERM");
    },
    rename: async () => {
      throw coded("ENOSPC");
    },
    rm: async (...args: Parameters<typeof real.rm>) => {
      if (faults.stuck.some((prefix) => String(args[0]).startsWith(prefix))) throw coded("EBUSY");
      return real.rm(...args);
    },
  };
});

import { saveWithRetry } from "../src/cli/save-retry.js";
import { publishNewFolder, publishNewPrivateFile } from "../src/export/private-file.js";
import { questionsOnPrivateScreen, seen, terminal } from "./helpers/question-terminal.js";

questionsOnPrivateScreen();
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mnemocode-save-reservation-"));
  // Skip at "What now?": the notices of the one failure are all there is to read.
  terminal.choices = ["skip"];
});
afterEach(() => {
  faults.stuck = [];
  rmSync(root, { recursive: true, force: true });
});

it("says why a file was not saved, then the empty file that reserved its name, to delete", async () => {
  const path = join(root, "public-record.txt");
  faults.stuck = [path];
  const saved = await saveWithRetry({
    what: "The record",
    kind: "file",
    path,
    write: (name) => publishNewPrivateFile(name, new TextEncoder().encode("public fixture")),
    checkName: async () => undefined,
  });
  expect(saved).toBeUndefined();
  expect(seen.notices).toEqual([
    `The record could not be saved as ${path}: the disk is full.`,
    `The empty file ${path}, made to reserve its name, could not be removed: delete it.`,
    "The record was not saved.",
  ]);
});

it("names the new folder and the staging folder when a folder save left both", async () => {
  const path = join(root, "cards");
  const prefix = ".card-collection-";
  faults.stuck = [path, join(root, prefix)];
  const saved = await saveWithRetry({
    what: "The card files",
    plural: true,
    kind: "folder",
    path,
    write: (name) =>
      publishNewFolder(name, prefix, "cards", async (staging) =>
        writeFileSync(join(staging, "01-card.png"), "public fixture"),
      ),
    checkName: async () => undefined,
  });
  expect(saved).toBeUndefined();
  const [why, folder, staging, skipped] = seen.notices;
  expect(why).toBe(`The card files could not be saved as ${path}: the disk is full.`);
  expect(folder).toBe(
    `The new folder ${path}, which may hold some of its files, could not be removed: delete it.`,
  );
  expect(staging).toMatch(
    /^Its private staging folder .*\.card-collection-\S*, which may hold a copy, could not be removed: delete it\.$/u,
  );
  // Several things: "were" (Saving.plural).
  expect(skipped).toBe("The card files were not saved.");
  expect(seen.notices).toHaveLength(4);
});
