// AUD-014: exercise the real publication helpers with public opaque bytes, never a PDF.
// Only the expensive render seam and one controlled staging-cleanup error are substituted.
// Opt in through probe.config.ts; these intentionally failing probes are not ordinary tests.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import * as actualFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failCleanup: false }));
vi.mock("../../../src/export/render.js", () => ({
  renderCards: vi.fn(async () => new TextEncoder().encode("public generated-document fixture")),
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (state.failCleanup && String(args[0]).includes(".mnemocode-export-"))
        throw Object.assign(new Error("synthetic staging cleanup denied"), { code: "EACCES" });
      return fs.rm(...args);
    },
  };
});

import { exportCards } from "../../../src/export/pdf.js";
import { publishNewPrivateFile } from "../../../src/export/private-file.js";
import { preflightFileDestination, settleOutputPaths } from "../../../src/cli/output-paths.js";

const folders: string[] = [];
afterEach(async () => {
  state.failCleanup = false;
  for (const path of folders.splice(0)) await actualFs.rm(path, { recursive: true, force: true });
});

it("CLI document save preserves a destination created after preflight", async () => {
  const folder = await mkdtemp(join(tmpdir(), "mnemocode-aud014-write-"));
  folders.push(folder);
  const path = join(folder, "public-output.bin");
  const args = { pdf: path };
  await settleOutputPaths(args);
  await preflightFileDestination(path, false);
  await writeFile(path, "public file created during rendering");
  let failure: unknown;
  try {
    await exportCards([], path);
  } catch (error) {
    failure = error;
  }
  const preserved = (await readFile(path, "utf8")) === "public file created during rendering";
  console.log(
    JSON.stringify({
      probe: "overwrite-after-preflight",
      refused: failure !== undefined,
      preserved,
    }),
  );
  expect({ refused: failure !== undefined, preserved }).toEqual({ refused: true, preserved: true });
});

it("a staging-cleanup failure does not report a completed publication as an ordinary failed save", async () => {
  const folder = await mkdtemp(join(tmpdir(), "mnemocode-aud014-cleanup-"));
  folders.push(folder);
  const path = join(folder, "public-output.bin");
  state.failCleanup = true;
  let failure: unknown;
  try {
    await publishNewPrivateFile(path, new TextEncoder().encode("public fixture"));
  } catch (error) {
    failure = error;
  }
  const published = (await readFile(path, "utf8")) === "public fixture";
  console.log(
    JSON.stringify({
      probe: "cleanup-after-publication",
      published,
      failure: failure instanceof Error ? failure.message : null,
    }),
  );
  expect(published).toBe(true);
  expect(failure).toBeUndefined();
});
