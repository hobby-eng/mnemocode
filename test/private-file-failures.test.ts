import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FailedSaveLeftCopyError,
  publishNewFolder,
  publishNewPrivateFile,
} from "../src/export/private-file.js";

// A save that fails and whose private staging folder cannot be removed either (AUD-037-SEC007):
// the failure is kept as the cause, and the folder is named, as it may hold a copy. A folder
// published whose reservation is gone when the save fails keeps that failure too. The faults are
// the file system's, the program's edge: a removal that fails, as of a folder that another
// program holds open, and a reserved folder that another process removes before the files are
// moved in.
const faults = vi.hoisted(() => ({ removalFails: false, reservationGone: false }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (...removal: Parameters<typeof actual.rm>) => {
      if (faults.removalFails)
        throw Object.assign(new Error("Synthetic removal fault."), { code: "EBUSY" });
      return actual.rm(...removal);
    },
    rename: async (...move: Parameters<typeof actual.rename>) => {
      const [, destination] = move;
      if (faults.reservationGone && typeof destination === "string")
        rmSync(dirname(destination), { recursive: true });
      return actual.rename(...move);
    },
  };
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mnemocode-save-failure-"));
  faults.removalFails = true;
});
afterEach(() => {
  faults.removalFails = false;
  faults.reservationGone = false;
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
    faults.removalFails = false;
    faults.reservationGone = true;
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
