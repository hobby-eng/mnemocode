// AUD-014: the findings and recommendations of the command line, each with the public case that
// showed it and a well-formed control. Public test data only: the BIP39 test phrase of the
// vectors, synthetic file names, and opaque public bytes where the publisher of files is tested
// alone.

import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What happens at the files' edge just before a finished export is linked to its name, such as
 * another program taking that name: a late collision.
 */
const files = vi.hoisted(
  (): { beforeLink: ((destination: string) => Promise<void>) | undefined } => ({
    beforeLink: undefined,
  }),
);
/** Opaque public bytes for the publisher of files, tested alone: never a PDF. */
const RENDERED = "public generated-document fixture";

// The files are the program's edge: a link runs as it is, after what a case puts before it.
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return {
    ...real,
    link: async (existing: string, destination: string) => {
      await files.beforeLink?.(destination);
      return real.link(existing, destination);
    },
  };
});
// The check that the external program pdftocairo runs is the other edge that is stubbed. Every
// rendering, publication, claim and preflight is the real one.
vi.mock("../src/export/image-export.js", async (original) => ({
  ...(await original<typeof import("../src/export/image-export.js")>()),
  assertImageRenderer: vi.fn(async () => undefined),
}));

import { assertAllowedArguments, parseArguments } from "../src/cli/arguments.js";
import { cloudServiceOf } from "../src/cli/cloud-folders.js";
import { runCommandLine } from "../src/cli/command-line.js";
import { runEncode } from "../src/cli/encode-command.js";
import {
  firstFreeName,
  preflightFileDestination,
  RenamedOutputs,
} from "../src/cli/output-paths.js";
import { preflightOutputs } from "../src/cli/output-saving.js";
import { runPreview } from "../src/cli/preview-command.js";
import { PROTECTION_FLAGS } from "../src/cli/protection.js";
import { swapWarning, unencryptedSwap } from "../src/cli/swap-check.js";
import { assertImageRenderer, IMAGE_FOLDER_TAKEN } from "../src/export/image-export.js";
import { plannedCardJob } from "../src/export/render.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { selectTemplate } from "../src/export/templates.js";
import { NewFolder, publishNewPrivateFile } from "../src/export/private-file.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";
import { TEST_TIME_LIMIT_MS } from "./helpers/limits.js";
import { testFolder } from "./helpers/test-folders.js";

/** A new empty folder for one case, removed after it. */
function scratch(): Promise<string> {
  return testFolder("mnemocode-aud014-cli-");
}

afterEach(() => {
  files.beforeLink = undefined;
  vi.restoreAllMocks();
  vi.mocked(assertImageRenderer).mockClear();
});

/**
 * The command line from the sources under the Node.js permission model, as a caller that started
 * it so would: the protection flags, with reads limited to `reads` when given. tsx, which runs
 * the sources, needs a worker thread and probes the name of this folder in the other case.
 */
function protectedRun(argv: readonly string[], reads?: readonly string[]) {
  const readFlags =
    reads === undefined
      ? PROTECTION_FLAGS.filter((flag) => flag.startsWith("--allow-fs-read"))
      : reads.map((path) => `--allow-fs-read=${path}`);
  return spawnSync(
    process.execPath,
    [
      ...PROTECTION_FLAGS.filter((flag) => !flag.startsWith("--allow-fs-read")),
      ...readFlags,
      "--allow-worker",
      "--disable-warning=PERM0006",
      "--import",
      "tsx",
      "src/mnemocode.ts",
      ...argv,
    ],
    { encoding: "utf8", timeout: TEST_TIME_LIMIT_MS, env: { ...process.env, NO_COLOR: "1" } },
  );
}

/** The case-swapped name of the current folder, which tsx looks at to learn the file system. */
function swappedCase(path: string): string {
  return Array.from(path, (character) =>
    character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase(),
  ).join("");
}

/** The heading of /proc/swaps; the areas follow, one per line. */
const SWAPS_HEADER = "Filename\tType\tSize\tUsed\tPriority\n";

it("refuses invalid card settings through the real planner", async () => {
  const operation: unknown = Reflect.apply(plannedCardJob, undefined, [
    nodeCardRenderer,
    {
      template: selectTemplate("business-it"),
      content: {
        kind: "colors",
        colors: ["123456"],
        payload: "public card-planning fixture",
        pageSize: "synthetic-invalid-page-size",
      },
    },
  ]);
  await expect(operation).rejects.toHaveProperty("code", "export.card-settings.page-size");
});

describe("AUD-014-SEC002: a swap table that cannot be read is not taken for no swap", () => {
  it("reports an unreadable table as unknown, and keeps the known answers", async () => {
    const missing = await scratch();
    expect(() => unencryptedSwap(missing)).toThrow(expect.objectContaining({ code: "ENOENT" }));
    expect(swapWarning(missing)).toBe(
      "Swap may write this memory to the disk unencrypted: MnemoCode cannot read /proc/swaps to tell",
    );
    // Controls: a readable table without swap gives no warning, and a plain partition the same
    // warning as before.
    const none = await scratch();
    await mkdir(join(none, "proc"));
    await writeFile(join(none, "proc", "swaps"), SWAPS_HEADER);
    expect(swapWarning(none)).toBeUndefined();
    const plain = await scratch();
    await mkdir(join(plain, "proc"));
    await mkdir(join(plain, "dev"));
    await mkdir(join(plain, "sys", "class", "block", "sda2", "slaves"), { recursive: true });
    await writeFile(join(plain, "dev", "sda2"), "");
    await writeFile(join(plain, "proc", "swaps"), `${SWAPS_HEADER}/dev/sda2 partition 8 0 -2\n`);
    expect(swapWarning(plain)).toBe(
      "Swap may write this memory to the disk unencrypted: /dev/sda2",
    );
  });

  it.runIf(process.platform === "linux")(
    "warns in a real protected run whose permissions deny /proc/swaps",
    async () => {
      const cwd = process.cwd();
      const publicFile = join(await scratch(), "public-mnemonic.txt");
      await writeFile(publicFile, TEST_PHRASE, "utf8");
      const run = protectedRun(
        ["encode", "--mode", "direct", "--format", "indexes", "--mnemonic-file", publicFile],
        [cwd, swappedCase(cwd), publicFile],
      );
      expect(run.status, run.stderr).toBe(0);
      expect(run.stderr).toContain(
        "Swap may write this memory to the disk unencrypted: MnemoCode cannot read /proc/swaps to tell",
      );
      expect(run.stderr).toContain("#unencrypted-swap");
      // The command itself still works: the warning only comes first.
      expect(run.stdout).toContain("1 1 1 1 1 1 1 1 1 1 1 4");
    },
  );
});

describe("AUD-014-API010: a valued --__proto__ is an ordinary unknown option", () => {
  it("keeps the typed name as a key of its own and refuses it", () => {
    const parsed = parseArguments(["--__proto__", "synthetic-value"]);
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
    expect(parsed["__proto__"]).toBe("synthetic-value");
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    // No name is found among those that every object inherits.
    expect(parseArguments(["--word", "abandon"])["constructor"]).toBeUndefined();
    expect(() => assertAllowedArguments(parsed, "table", ["word"])).toThrow(
      "The table command does not support",
    );
    // A repeated one is refused as every repeated option is.
    expect(() =>
      assertAllowedArguments(parseArguments(["--__proto__", "a", "--__proto__", "b"]), "table", [
        "word",
      ]),
    ).toThrow("Provide only one value");
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "refuses --%s in the command line, and takes the options of the command",
    async (key) => {
      await expect(
        runCommandLine(["table", "--word", "abandon", `--${key}`, "synthetic-value"]),
      ).rejects.toThrow("The table command does not support");
      // Control: the command's own option is taken.
      const parsed = parseArguments(["--word", "abandon"]);
      expect(Object.keys(parsed)).toEqual(["word"]);
      expect(() => assertAllowedArguments(parsed, "table", ["word"])).not.toThrow();
    },
  );
});

describe("AUD-014-API011: numbering keeps a literal trailing backslash on POSIX", () => {
  it.runIf(process.platform !== "win32")(
    "numbers a taken name ending with a backslash",
    async () => {
      const root = await scratch();
      const named = join(root, "public-record\\");
      await writeFile(named, "public fixture");
      expect(await firstFreeName(named)).toBe(`${named}-1`);
      // A folder given with a trailing backslash, which is part of its name here.
      const folder = join(root, "public-pages\\");
      await mkdir(folder);
      const args: Record<string, string> = { "images-dir": folder };
      await RenamedOutputs.settle(args);
      expect(args["images-dir"]).toBe(`${folder}-1`);
      RenamedOutputs.discard(args["images-dir"]!);
      // A backslash in a folder name does not split it into a cloud folder.
      expect(
        cloudServiceOf("/home/test/notes\\Dropbox/cards.pdf", {}, "/home/test"),
      ).toBeUndefined();
    },
  );

  it("still drops the separators of this system at the end of a folder", async () => {
    const root = await scratch();
    const folder = join(root, "public-pages");
    await mkdir(folder);
    const args: Record<string, string> = { "images-dir": `${folder}/` };
    await RenamedOutputs.settle(args);
    expect(args["images-dir"]).toBe(`${folder}-1`);
    RenamedOutputs.discard(args["images-dir"]!);
    expect(await firstFreeName(join(root, "absent.pdf"))).toBe(join(root, "absent.pdf"));
    expect(cloudServiceOf("/home/test/Dropbox/cards.pdf", {}, "/home/test")).toBe("Dropbox");
  });
});

describe("AUD-014-FUN003: a PDF is never saved over a name taken after the preflight", () => {
  /** The content of the file that took the name while the PDF was rendered. */
  const LATE = "public file created during rendering";

  /** Takes `name` with the late file when the export is about to link its PDF there. */
  async function lateFile(destination: string, name: string): Promise<void> {
    if (destination === name) await writeFile(name, LATE);
  }

  // These controls test the publisher alone; the CLI case below renders real cards.
  it("refuses the name taken after the real preflight, keeping that file", async () => {
    const folder = await scratch();
    const path = join(folder, "public-output.bin");
    await RenamedOutputs.settle({ pdf: path });
    await preflightFileDestination(path, false);
    await writeFile(path, LATE);
    await expect(
      publishNewPrivateFile(path, new TextEncoder().encode(RENDERED)),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path, "utf8")).toBe(LATE);
    expect(await readdir(folder)).toEqual(["public-output.bin"]);
  });

  it("publishes new private bytes where nothing is", async () => {
    const folder = await scratch();
    const path = join(folder, "public-output.pdf");
    await publishNewPrivateFile(path, new TextEncoder().encode(RENDERED));
    expect(await readFile(path, "utf8")).toBe(RENDERED);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(folder)).toEqual(["public-output.pdf"]);
  });

  it("refuses it in Preview and in Encode, whose PDFs go the same way", async () => {
    const folder = await scratch();
    const preview = join(folder, "preview.pdf");
    files.beforeLink = (destination) => lateFile(destination, preview);
    await expect(runPreview({ pdf: preview })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(preview, "utf8")).toBe(LATE);
    const encoded = join(folder, "encoded.pdf");
    files.beforeLink = (destination) => lateFile(destination, encoded);
    await expect(
      runEncode({
        mnemonic: TEST_PHRASE,
        mode: "direct",
        format: "colors",
        pdf: encoded,
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(encoded, "utf8")).toBe(LATE);
    expect((await readdir(folder)).sort()).toEqual(["encoded.pdf", "preview.pdf"]);
  });
});

describe("AUD-014 recommendation 35: one owner of the image-folder preflight", () => {
  it("claims a new image folder once, then checks the renderer", async () => {
    const root = await scratch();
    const images = join(root, "pages");
    const claim = vi.spyOn(NewFolder, "claim");
    await preflightOutputs({ "images-dir": images });
    expect(claim.mock.calls.filter(([path]) => path === images)).toHaveLength(1);
    expect(assertImageRenderer).toHaveBeenCalledTimes(1);
    // A claim only checks: nothing is made.
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses a taken folder before the renderer is asked", async () => {
    const root = await scratch();
    await expect(preflightOutputs({ "images-dir": root })).rejects.toThrow(IMAGE_FOLDER_TAKEN);
    expect(assertImageRenderer).not.toHaveBeenCalled();
    // Without image outputs the renderer is not needed.
    await preflightOutputs({ pdf: join(root, "cards.pdf") });
    expect(assertImageRenderer).not.toHaveBeenCalled();
  });
});

describe("AUD-014 recommendation 27: the release script reports through describeError", () => {
  it("loads its shared modules and reports a refusal in one line", () => {
    const run = spawnSync(process.execPath, ["scripts/sign-release.mjs", "--bogus"], {
      encoding: "utf8",
      timeout: TEST_TIME_LIMIT_MS,
      env: { ...process.env, NO_COLOR: "1" },
    });
    expect(run.status).toBe(1);
    expect(run.stderr.trim()).toBe("sign-release: Unknown option; see --help.");
  });
});
