import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fillingFolder,
  makeTemporaryFolder,
  removeLeftFolders,
  removeTemporaryFolder,
  sameFolder,
} from "../src/export/temporary-folders.js";

// The temporary folders of exports (temporary-folders.ts), which a process stopped at once
// removes before it exits (AUD-037-SEC002).

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mnemocode-temporary-"));
});
afterEach(() => {
  removeLeftFolders();
  rmSync(root, { recursive: true, force: true });
});

describe("the temporary folders of exports", () => {
  it("are removed at an exit when their owners did not remove them", async () => {
    const left = await makeTemporaryFolder(join(root, ".mnemocode-export-"));
    writeFileSync(join(left, "document"), "public fixture");
    const removed = await makeTemporaryFolder(join(root, "mnemocode-raster-"));
    await removeTemporaryFolder(removed);
    expect(removeLeftFolders()).toEqual([]);
    expect(existsSync(left)).toBe(false);
    // Nothing is left to remove a second time.
    expect(removeLeftFolders()).toEqual([]);
  });

  it("keep a folder that must be empty and is not, for the exit", async () => {
    const staging = await makeTemporaryFolder(join(root, ".card-collection-"));
    writeFileSync(join(staging, "01-card.png"), "public fixture");
    await expect(removeTemporaryFolder(staging, { empty: true })).rejects.toHaveProperty(
      "code",
      "ENOTEMPTY",
    );
    expect(existsSync(staging)).toBe(true);
    removeLeftFolders();
    expect(existsSync(staging)).toBe(false);
  });

  it("are told apart by their device and inode, whatever their times say", () => {
    const made = lstatSync(root);
    // On some systems a birth time is the change time, which filling the folder changes.
    const filled = {
      dev: made.dev,
      ino: made.ino,
      birthtimeMs: made.birthtimeMs + 1000,
      ctimeMs: made.ctimeMs + 1000,
      mtimeMs: made.mtimeMs + 1000,
    };
    expect(sameFolder(filled, made)).toBe(true);
    expect(sameFolder({ dev: made.dev, ino: made.ino + 1 }, made)).toBe(false);
    expect(sameFolder({ dev: made.dev + 1, ino: made.ino }, made)).toBe(false);
    expect(sameFolder(undefined, made)).toBe(false);
  });

  it("remove an output folder left part filled, while it is the one made", () => {
    const output = join(root, "cards");
    // Noted when made, then filled, as publishNewFolder does: filling it changes its times.
    mkdirSync(output);
    fillingFolder(output, lstatSync(output));
    writeFileSync(join(output, "01-card.png"), "public fixture");
    expect(removeLeftFolders()).toEqual([]);
    expect(existsSync(output)).toBe(false);
    // A folder that took its name since is someone else's. The one made is moved away, not
    // removed, so that the file system cannot give its identity to the new one.
    mkdirSync(output);
    const made = lstatSync(output);
    renameSync(output, join(root, "moved"));
    mkdirSync(output);
    fillingFolder(output, made);
    removeLeftFolders();
    expect(existsSync(output)).toBe(true);
  });
});
