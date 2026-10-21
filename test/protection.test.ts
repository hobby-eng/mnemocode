import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseArguments } from "../src/cli/arguments.js";
import { cloudServiceOf } from "../src/cli/cloud-folders.js";
import { neededPermissions, PROTECTION_FLAGS } from "../src/cli/protection.js";
import { swapWarning, unencryptedSwap } from "../src/cli/swap-check.js";
import { COMMAND_FACTS, type CommandName } from "../src/cli/command-options.js";
import { runBuiltCli } from "./helpers/built-cli.js";
import { LONGEST_TEST_TIME_LIMIT_MS } from "./helpers/limits.js";

const execute = promisify(execFile);

/** A made-up /proc and /sys under a temporary folder, as mhfe's tests build them. */
async function withFakeSystem(
  build: (root: string) => Promise<void>,
  check: (root: string) => void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "mnemocode-swap-"));
  try {
    await mkdir(join(root, "proc"), { recursive: true });
    await mkdir(join(root, "dev", "mapper"), { recursive: true });
    await mkdir(join(root, "sys", "class", "block"), { recursive: true });
    await build(root);
    check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const SWAPS_HEADER = "Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority\n";

/** A block device in the fake /sys, with a dm uuid and the devices below it if given. */
async function blockDevice(
  root: string,
  name: string,
  options: { uuid?: string; slaves?: string[] } = {},
): Promise<void> {
  const device = join(root, "sys", "class", "block", name);
  await mkdir(join(device, "slaves"), { recursive: true });
  if (options.uuid !== undefined) {
    await mkdir(join(device, "dm"), { recursive: true });
    await writeFile(join(device, "dm", "uuid"), `${options.uuid}\n`);
  }
  for (const slave of options.slaves ?? []) await mkdir(join(device, "slaves", slave));
  await writeFile(join(root, "dev", name), "");
}

describe("swap check", () => {
  it("accepts no swap, zram, dm-crypt and LVM on dm-crypt", async () => {
    await withFakeSystem(
      async (root) => {
        await blockDevice(root, "zram0");
        await blockDevice(root, "dm-0", { uuid: "CRYPT-LUKS2-0123-cryptswap" });
        await blockDevice(root, "dm-1", { uuid: "LVM-abc", slaves: ["dm-0"] });
        await symlink("../dm-1", join(root, "dev", "mapper", "vg-swap"));
        await writeFile(
          join(root, "proc", "swaps"),
          `${SWAPS_HEADER}/dev/zram0 partition 8 0 100\n/dev/dm-0 partition 8 0 -2\n/dev/mapper/vg-swap partition 8 0 -3\n`,
        );
      },
      (root) => expect(unencryptedSwap(root)).toEqual([]),
    );
    await withFakeSystem(
      async (root) => writeFile(join(root, "proc", "swaps"), SWAPS_HEADER),
      (root) => expect(unencryptedSwap(root)).toEqual([]),
    );
  });

  it("names a plain partition, LVM on a plain disk and a device it cannot trace", async () => {
    await withFakeSystem(
      async (root) => {
        await blockDevice(root, "sda2");
        await blockDevice(root, "sdb1");
        await blockDevice(root, "dm-2", { uuid: "LVM-def", slaves: ["sdb1"] });
        await writeFile(
          join(root, "proc", "swaps"),
          `${SWAPS_HEADER}/dev/sda2 partition 8 0 -2\n/dev/dm-2 partition 8 0 -3\n/swap\\040file file 8 0 -4\n`,
        );
      },
      (root) => expect(unencryptedSwap(root)).toEqual(["/dev/sda2", "/dev/dm-2", "/swap file"]),
    );
  });

  it.each([
    ["empty", ""],
    ["without its first line", "/dev/sda2 partition 8 0 -2\n"],
    ["with a line cut short after its path", `${SWAPS_HEADER}/dev/sda2\n`],
    ["with a line cut short after its type", `${SWAPS_HEADER}/dev/sda2 partition\n`],
    ["with a line that names no area", `${SWAPS_HEADER}%%%\n`],
    ["with a type that Linux does not write", `${SWAPS_HEADER}/dev/sda2 disk 8 0 -2\n`],
    ["with an escape of two digits", `${SWAPS_HEADER}/swap\\04file file 8 0 -2\n`],
    ["with an escape beyond ASCII", `${SWAPS_HEADER}/swap\\777file file 8 0 -2\n`],
  ])("warns that swap is unknown for a table %s, as for one it cannot read", async (_, table) => {
    await withFakeSystem(
      async (root) => {
        // A plain partition, which a table that left its line out would leave out of the warning.
        await blockDevice(root, "sda2");
        await writeFile(join(root, "proc", "swaps"), table);
      },
      (root) => {
        expect(() => unencryptedSwap(root)).toThrow(
          expect.objectContaining({ code: "cli.swap-check.swap-table-unreadable" }),
        );
        expect(swapWarning(root)).toBe(
          "Swap may write this memory to the disk unencrypted: MnemoCode cannot read /proc/swaps to tell",
        );
      },
    );
  });
});

describe("cloud folders", () => {
  const home = "/home/test";
  it.each([
    ["/home/test/Dropbox/cards.pdf", "Dropbox"],
    ["/home/test/Dropbox (Work)/cards.pdf", "Dropbox"],
    ["/home/test/OneDrive - Contoso/record.txt", "OneDrive"],
    ["/home/test/Yandex.Disk/shares.txt", "Yandex Disk"],
    ["/home/test/Library/Mobile Documents/com~apple~CloudDocs/a.pdf", "iCloud Drive"],
    ["/home/test/Library/CloudStorage/GoogleDrive-a@example.org/My Drive/a.pdf", "Google Drive"],
    ["/home/test/Library/CloudStorage/Box-Box/a.pdf", "Box"],
  ])("recognises %s as a folder of %s", (path, service) => {
    expect(cloudServiceOf(path, {}, home)).toBe(service);
  });

  it("recognises the OneDrive folder that Windows names, and leaves local folders alone", () => {
    expect(cloudServiceOf("/data/Sync/cards.pdf", { OneDrive: "/data/Sync" }, home)).toBe(
      "OneDrive",
    );
    expect(cloudServiceOf("/home/test/Documents/cards.pdf", {}, home)).toBeUndefined();
    // A file called Dropbox is not a synchronised folder.
    expect(cloudServiceOf("/home/test/Documents/Dropbox", {}, home)).toBeUndefined();
  });
});

describe("process protection", () => {
  it("lets a command write and run programs only when it saves files or draws images", () => {
    const needs = (command: CommandName, items: string[]) =>
      neededPermissions(COMMAND_FACTS[command].alwaysWrites, parseArguments(items));
    expect(needs("decode", ["--ask-secrets"])).toEqual({ writes: false, runsPrograms: false });
    expect(needs("encode", ["--ask-secrets", "--pdf", "cards.pdf"])).toEqual({
      writes: true,
      runsPrograms: false,
    });
    expect(needs("encode", ["--ask-secrets", "--heir-sheet", "heirs.pdf"])).toEqual({
      writes: true,
      runsPrograms: false,
    });
    expect(needs("recover-word", ["--ask-secrets", "--candidates-file", "c.txt"])).toEqual({
      writes: true,
      runsPrograms: false,
    });
    expect(needs("encode", ["--ask-secrets", "--images-dir", "cards"])).toEqual({
      writes: true,
      runsPrograms: true,
    });
    expect(needs("self-test", [])).toEqual({ writes: true, runsPrograms: false });
  });

  it(
    "runs every start under the permission model, without network, with core dumps off",
    async () => {
      // A plain node start runs the program again with PROTECTION_FLAGS; the self-test reports it.
      const { stdout, stderr } = await runBuiltCli(["self-test"]);
      const report = `${stdout}${stderr}`;
      expect(report).toContain("Process protection");
      expect(report).toContain("no network");
      if (process.platform === "linux" || process.platform === "darwin")
        expect(report).toContain("no core dumps");
      expect(PROTECTION_FLAGS).toContain("--permission");
      expect(PROTECTION_FLAGS.some((flag) => flag.startsWith("--allow-net"))).toBe(false);
    },
    LONGEST_TEST_TIME_LIMIT_MS,
  );

  it.runIf(process.platform === "linux" || process.platform === "darwin")(
    "asks for no secret where core dumps could not be switched off, as without node:ffi",
    async () => {
      // A caller's permission model without --allow-ffi: the sandbox cannot reach the system.
      const script = `
        import("./dist/cli/protection.js").then(async ({ ProcessProtection }) => {
          await ProcessProtection.harden();
          ProcessProtection.dropUnneeded(false, {});
          try { ProcessProtection.assert(); console.log("protected"); }
          catch (error) { console.log(error.message); }
        });`;
      const { stdout } = await execute(process.execPath, [
        "--permission",
        "--allow-fs-read=*",
        "--input-type=module",
        "-e",
        script,
      ]);
      expect(stdout).toContain("MnemoCode could not switch off core dumps (");
      expect(stdout).toContain("--allow-ffi");
    },
  );

  it("gives up file writes when a command saves nothing", async () => {
    const script = `
      import("./dist/cli/protection.js").then(async ({ ProcessProtection }) => {
        await ProcessProtection.harden();
        ProcessProtection.dropUnneeded(false, {});
        console.log(ProcessProtection.summary());
      });`;
    const { stdout } = await execute(process.execPath, [
      ...PROTECTION_FLAGS,
      "--input-type=module",
      "-e",
      script,
    ]);
    expect(stdout).toContain("no network · no other programs · no file writes");
  });
});
