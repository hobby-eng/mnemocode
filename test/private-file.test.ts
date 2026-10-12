import { describe, expect, it } from "vitest";
import {
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishNewPrivateFile } from "../src/export/private-file.js";

// Every file export is published as a new file and never replaces anything (AUD-014-FUN003): the
// replacing writer these cases once checked is gone, and they now check that nothing is replaced.
describe("Private export publication", () => {
  it("publishes a new private file and leaves no staging folder", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-private-"));
    try {
      const destination = join(directory, "export");
      await publishNewPrivateFile(destination, Buffer.from("Public test output."));
      expect(await readFile(destination, "utf8")).toBe("Public test output.");
      if (process.platform !== "win32") expect((await stat(destination)).mode & 0o777).toBe(0o600);
      expect(await readdir(directory)).toEqual(["export"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a destination symlink, keeping the link and its target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-private-"));
    try {
      const target = join(directory, "target");
      const destination = join(directory, "export");
      await writeFile(target, "Keep this content.");
      await symlink(target, destination);
      await expect(
        publishNewPrivateFile(destination, Buffer.from("Public test output.")),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(target, "utf8")).toBe("Keep this content.");
      expect(await readlink(destination)).toBe(target);
      expect((await readdir(directory)).sort()).toEqual(["export", "target"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains an existing directory and removes its staging files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-private-"));
    try {
      const destination = await mkdtemp(join(directory, "keep-"));
      await writeFile(join(destination, "marker"), "Keep this content.");
      await expect(
        publishNewPrivateFile(destination, Buffer.from("Public test output.")),
      ).rejects.toThrow();
      expect(await readFile(join(destination, "marker"), "utf8")).toBe("Keep this content.");
      expect(await readdir(directory)).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
