import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FailedSaveLeftCopyError,
  FailedSaveLeftReservationError,
  publishNewFolder,
  publishNewPrivateFile,
} from "../src/export/private-file.js";

// A save that fails and whose reservation of the final name cannot be removed either: the save's
// failure stays the cause of what is thrown, and the reservation is named (CORE-22). Faults come
// from the file system only, by path.

interface Faults {
  /** link fails as on FAT and exFAT, so the file is published by reservation and rename. */
  noHardLinks: boolean;
  /** rename fails, as the move of a finished file or of a folder's child. */
  renameFails: boolean;
  /** Whether the rename has failed yet. */
  renameFailed: boolean;
  /** The paths, by prefix, whose removal fails. */
  stuck: string[];
  /** A path whose lstat fails once the rename has failed. */
  unreadable: string | undefined;
  /** An Error with the errno-style `code`, as the file system gives. */
  coded: (code: string) => Error;
}

const faults = vi.hoisted((): Faults => ({
  noHardLinks: false,
  renameFails: false,
  renameFailed: false,
  stuck: [],
  unreadable: undefined,
  coded: (code) => Object.assign(new Error(`Synthetic ${code} fault.`), { code }),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    link: async (...args: Parameters<typeof original.link>) => {
      if (faults.noHardLinks) throw faults.coded("EPERM");
      return original.link(...args);
    },
    rename: async (...args: Parameters<typeof original.rename>) => {
      if (!faults.renameFails) return original.rename(...args);
      faults.renameFailed = true;
      throw faults.coded("EXDEV");
    },
    rm: async (...args: Parameters<typeof original.rm>) => {
      if (faults.stuck.some((prefix) => String(args[0]).startsWith(prefix)))
        throw faults.coded("EBUSY");
      return original.rm(...args);
    },
    lstat: async (...args: Parameters<typeof original.lstat>) => {
      if (faults.renameFailed && String(args[0]) === faults.unreadable)
        throw faults.coded("EACCES");
      return original.lstat(...args);
    },
  };
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mnemocode-reservation-"));
  faults.renameFails = true;
});
afterEach(() => {
  Object.assign(faults, {
    noHardLinks: false,
    renameFails: false,
    renameFailed: false,
    stuck: [],
    unreadable: undefined,
  });
  rmSync(root, { recursive: true, force: true });
});

/** Publishes one public fixture file as the new folder `cards` of the test root. */
async function publishCards(): Promise<unknown> {
  const write = async (staging: string) =>
    writeFileSync(join(staging, "01-card.png"), "public fixture");
  return publishNewFolder(join(root, "cards"), ".card-collection-", "x", write).catch(
    (error: unknown) => error,
  );
}

describe("a failed save whose reservation stays", () => {
  it("keeps why a file could not be saved when its empty reservation cannot be removed", async () => {
    faults.noHardLinks = true;
    const path = join(root, "codes.txt");
    faults.stuck = [path];
    const failure = await publishNewPrivateFile(path, Buffer.from("public fixture")).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(FailedSaveLeftReservationError);
    expect(failure).toMatchObject({
      code: "failed-save-left-reservation",
      reservation: path,
      cause: { code: "EXDEV" },
      removal: { code: "EBUSY" },
    });
    expect(readdirSync(root)).toEqual(["codes.txt"]);
  });

  it("keeps why a folder could not be published when the new folder cannot be removed", async () => {
    const target = join(root, "cards");
    faults.stuck = [target];
    const failure = await publishCards();
    expect(failure).toBeInstanceOf(FailedSaveLeftReservationError);
    expect(failure).toMatchObject({
      code: "failed-save-left-reservation",
      reservation: target,
      cause: { code: "EXDEV" },
      removal: { code: "EBUSY" },
    });
  });

  it("keeps why a folder could not be published when the new folder cannot be looked at again", async () => {
    const target = join(root, "cards");
    faults.unreadable = target;
    const failure = await publishCards();
    expect(failure).toMatchObject({
      code: "failed-save-left-reservation",
      reservation: target,
      cause: { code: "EXDEV" },
      removal: { code: "EACCES" },
    });
  });

  it("names the staging folder too when neither it nor the new folder can be removed", async () => {
    faults.stuck = [join(root, "cards"), join(root, ".card-collection-")];
    const failure = await publishCards();
    expect(failure).toBeInstanceOf(FailedSaveLeftReservationError);
    if (!(failure instanceof FailedSaveLeftReservationError)) return;
    const left = failure.cause;
    expect(left).toBeInstanceOf(FailedSaveLeftCopyError);
    if (!(left instanceof FailedSaveLeftCopyError)) return;
    expect(left).toMatchObject({
      code: "failed-save-left-staging-copy",
      cause: { code: "EXDEV" },
      removal: { code: "EBUSY" },
    });
    expect(left.staging).toContain(".card-collection-");
    expect(failure.message).toContain(left.staging);
  });
});
