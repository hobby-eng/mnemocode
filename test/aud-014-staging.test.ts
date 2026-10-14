// AUD-014, adjudication "Cleanup can fail after file publication": a file saved in full whose
// private staging folder cannot be removed is saved, and the person is told to delete the copy;
// it is never reported as a failed save, nor left unmentioned. Only the removal of the staging
// folder is made to fail; the file and its bytes are real. Public test data only.

import { mkdtemp, readFile } from "node:fs/promises";
import * as actualFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failCleanup: false, notices: [] as string[] }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (state.failCleanup && String(args[0]).includes(".mnemocode-export-"))
        throw Object.assign(new Error("staging cleanup denied"), { code: "EACCES" });
      return fs.rm(...args);
    },
  };
});
vi.mock("../src/cli/terminal.js", async (original) => ({
  ...(await original<typeof import("../src/cli/terminal.js")>()),
  terminalNotice: (text: string) => state.notices.push(text),
}));

import { LeftStagingCopyError, publishNewPrivateFile } from "../src/export/private-file.js";
import { writeSaved } from "../src/cli/save-retry.js";
import { saveQrBeside, saveQrInside } from "../src/cli/qr-export.js";

const BYTES = new TextEncoder().encode("public fixture");
const folders: string[] = [];

afterEach(async () => {
  state.failCleanup = false;
  state.notices = [];
  for (const path of folders.splice(0)) await actualFs.rm(path, { recursive: true, force: true });
});

async function newPath(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "mnemocode-aud014-staging-"));
  folders.push(folder);
  return join(folder, "public-output.bin");
}

describe("a staging copy left after a complete save", () => {
  it("is a LeftStagingCopyError with the saved file complete, not an ordinary failure", async () => {
    const path = await newPath();
    state.failCleanup = true;
    const failure = await publishNewPrivateFile(path, BYTES).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LeftStagingCopyError);
    expect((failure as LeftStagingCopyError).saved).toBe(path);
    expect((failure as LeftStagingCopyError).message).toMatch(/^Saved .*delete it\.$/u);
    expect(await readFile(path, "utf8")).toBe("public fixture");
  });

  it("counts as saved on the command line, which tells the person to delete the copy", async () => {
    const path = await newPath();
    state.failCleanup = true;
    await expect(writeSaved(() => publishNewPrivateFile(path, BYTES))).resolves.toBeUndefined();
    expect(state.notices).toHaveLength(1);
    expect(state.notices[0]).toMatch(/staging folder .* could not be removed: delete it\.$/u);
  });

  it("keeps every other failure a failure, and an ordinary save silent", async () => {
    const path = await newPath();
    await writeSaved(() => publishNewPrivateFile(path, BYTES));
    expect(state.notices).toEqual([]);
    // The name is taken now: that is a failed save, which writeSaved passes on.
    await expect(writeSaved(() => publishNewPrivateFile(path, BYTES))).rejects.toThrow();
    expect(state.notices).toEqual([]);
  });
});

describe("a QR code saved beside its sheet, whose staging copy is left (AUD-015-API003)", () => {
  /** A public payload, as a share QR code holds one. */
  const PAYLOAD = "ur:sskr/public-fixture";

  it("is saved beside the PDF and inside the folder, each with one warning", async () => {
    const sheet = await newPath();
    state.failCleanup = true;
    const beside = await saveQrBeside(PAYLOAD, sheet);
    const inside = await saveQrInside(PAYLOAD, join(sheet, ".."), "share-1");
    expect(beside).toMatch(/public-output-qr\.png$/u);
    expect(inside).toMatch(/share-1-qr\.png$/u);
    for (const path of [beside, inside]) expect((await readFile(path)).length).toBeGreaterThan(0);
    expect(state.notices).toHaveLength(2);
    for (const notice of state.notices)
      expect(notice).toMatch(/could not be removed: delete it\.$/u);
  });

  it("still fails a QR code that could not be written at all", async () => {
    const sheet = join(await newPath(), "missing-folder", "cards.pdf");
    await expect(saveQrBeside(PAYLOAD, sheet)).rejects.toThrow();
    expect(state.notices).toEqual([]);
  });
});
