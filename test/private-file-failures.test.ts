import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FailedSaveLeftCopyError,
  publishNewFolder,
  publishNewPrivateFile,
} from "../src/export/private-file.js";

// A save that fails and whose private staging folder cannot be removed either (AUD-037-SEC007):
// the failure is kept as the cause, and the folder is named, as it may hold a copy. A folder
// published whose reservation is gone when the save fails keeps that failure too.

const removal = vi.hoisted(() => ({ fails: false, reservationGone: false }));
vi.mock("../src/export/temporary-folders.js", async (original) => {
  const actual = await original<typeof import("../src/export/temporary-folders.js")>();
  return {
    ...actual,
    removeTemporaryFolder: async (folder: string, options?: { readonly empty?: boolean }) => {
      if (removal.fails)
        throw Object.assign(new Error("Synthetic removal fault."), { code: "EBUSY" });
      return actual.removeTemporaryFolder(folder, options);
    },
    // The folder is noted as filled right after it is reserved: another process removes it then.
    fillingFolder: (path: string, made: Parameters<typeof actual.fillingFolder>[1]) => {
      if (removal.reservationGone) rmSync(path, { recursive: true });
      return actual.fillingFolder(path, made);
    },
  };
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mnemocode-save-failure-"));
  removal.fails = true;
});
afterEach(() => {
  removal.fails = false;
  removal.reservationGone = false;
  rmSync(root, { recursive: true, force: true });
});

describe("a failed save whose staging folder stays", () => {
  it("keeps why a file could not be saved, and names the folder", async () => {
    const taken = join(root, "record.txt");
    writeFileSync(taken, "public fixture");
    const failure = await publishNewPrivateFile(taken, Buffer.from("public fixture")).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(FailedSaveLeftCopyError);
    if (!(failure instanceof FailedSaveLeftCopyError)) return;
    expect(failure.cause).toHaveProperty("code", "EEXIST");
    expect(failure.staging).toContain(".mnemocode-export-");
    expect(failure.message).toContain(failure.staging);
  });

  it("keeps why a folder could not be published, and names the folder", async () => {
    const write = async (): Promise<never> => {
      throw Object.assign(new Error("Synthetic disk full."), { code: "ENOSPC" });
    };
    const failure = await publishNewFolder(
      join(root, "cards"),
      ".card-collection-",
      "x",
      write,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FailedSaveLeftCopyError);
    expect(failure).toHaveProperty(["cause", "code"], "ENOSPC");
  });
});

describe("a failed folder publish whose reservation is gone", () => {
  it("keeps why the files could not be moved in", async () => {
    removal.fails = false;
    removal.reservationGone = true;
    const write = async (staging: string) =>
      writeFileSync(join(staging, "01-card.png"), "public fixture");
    const failure = await publishNewFolder(
      join(root, "cards"),
      ".card-collection-",
      "x",
      write,
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "ENOENT", syscall: "rename" });
  });
});
