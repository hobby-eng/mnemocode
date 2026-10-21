import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RenamedOutputs } from "../src/cli/output-paths.js";
import { saveWithRetry, writeSaved } from "../src/cli/save-retry.js";
import { warnOfCloudCopy } from "../src/cli/cloud-folders.js";
import { LeftStagingCopyError } from "../src/export/private-file.js";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { terminalFailure } from "../src/cli/terminal.js";
import { BUILT_CLI } from "./helpers/built-cli.js";
import { ESCAPE } from "./helpers/keys.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";
import { streamsAsTerminal } from "./helpers/terminal-streams.js";
import { TEST_TIME_LIMIT_MS } from "./helpers/limits.js";
import { testFolder } from "./helpers/test-folders.js";

vi.mock("node:tty", async (original) => ({
  ...(await original<typeof import("node:tty")>()),
  isatty: (descriptor: number) => descriptor === 0 || descriptor === 2,
}));
const typing = await vi.hoisted(async () => import("./helpers/typed-keys.js"));
vi.mock("../src/cli/terminal-input.js", async (original) =>
  typing.replacedTerminalInput(await original()),
);
const { keyboard } = typing;

const CONTROLS = [
  ["ESC", "\x1b[2J", "\ufffd[2J"],
  ["line breaks", "\r\n", "\ufffd\ufffd"],
  ["direction", "\u202e", "\ufffd"],
  ["line separators", "\u2028\u2029", "\ufffd\ufffd"],
  ["direction mark", "\u061c", "\ufffd"],
  ["SGR", "\x1b[31m", "\ufffd[31m"],
  ["OSC", "\x1b]0;public-title\x07", "\ufffd]0;public-title\ufffd"],
] as const;
const descriptors = [process.stdin, process.stdout, process.stderr].map((stream) => ({
  stream,
  tty: Object.getOwnPropertyDescriptor(stream, "isTTY"),
}));
let output: string[];

beforeEach(() => {
  output = [];
  vi.stubEnv("NO_COLOR", "1");
  vi.stubEnv("TERM", "xterm");
  for (const { stream } of descriptors)
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(console, "error").mockImplementation((line: unknown) => output.push(String(line)));
});
afterEach(() => {
  PrivateSteps.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const { stream, tty } of descriptors) {
    if (tty === undefined) Reflect.deleteProperty(stream, "isTTY");
    else Object.defineProperty(stream, "isTTY", tty);
  }
});

it.runIf(process.platform !== "win32")(
  "saves a real SSKR collection PDF at its exact controlled name but prints only a safe notice",
  async () => {
    const folder = await testFolder("mnemocode-public-sskr-path-");
    const mnemonic = join(folder, "public-mnemonic.txt");
    await writeFile(mnemonic, TEST_PHRASE, { mode: 0o600 });
    const pdf = join(folder, "public-\x1b[2J-\u202e.pdf");
    const child = spawnSync(
      process.execPath,
      [
        BUILT_CLI,
        "encode",
        "--sskr",
        "--mnemonic-file",
        mnemonic,
        "--threshold",
        "2",
        "--shares",
        "2",
        "--share-format",
        "colors",
        "--pdf",
        pdf,
      ],
      { encoding: "utf8", timeout: TEST_TIME_LIMIT_MS, stdio: ["ignore", "pipe", "pipe"] },
    );
    if (child.error) throw child.error;
    expect(child.status, child.stderr).toBe(0);
    expect(child.stderr).toContain(
      `Saved SSKR collection PDF: ${join(folder, "public-\ufffd[2J-\ufffd.pdf")}`,
    );
    expect(child.stderr).not.toContain("\x1b[2J");
    expect(child.stderr).not.toContain("\u202e");
    expect((await readFile(pdf)).subarray(0, 5).toString("ascii")).toBe("%PDF-");
  },
);

it.runIf(process.platform !== "win32").each(CONTROLS)(
  "renders %s filenames safely while preserving both actual filesystem names",
  async (_, raw, shown) => {
    const folder = await testFolder("mnemocode-public-path-display-");
    const original = join(folder, `public-${raw}-record.txt`);
    const numbered = join(folder, `public-${raw}-record-1.txt`);
    await writeFile(original, "public original");
    const args = { output: original };
    await RenamedOutputs.settle(args);
    expect(args.output).toBe(numbered);
    await writeFile(args.output, "public numbered");
    RenamedOutputs.report();
    expect(await readFile(original, "utf8")).toBe("public original");
    expect(await readFile(numbered, "utf8")).toBe("public numbered");
    expect(output.join(" ")).toContain(`public-${shown}-record`);
    expect(output.every((line) => !line.includes(raw))).toBe(true);
  },
);

it.each(CONTROLS)(
  "renders %s safely through the actual private save-failure and retry path",
  async (_, raw, shown) => {
    const path = `public-${raw}-record.txt`;
    const written: string[] = [];
    PrivateSteps.open(
      () => undefined,
      (warning) => output.push(warning),
    );
    for (const code of ["EACCES", undefined]) {
      keyboard.bytes = [ESCAPE.charCodeAt(0)];
      const failure = new Error(`Synthetic callback failure at ${path}`);
      if (code !== undefined) Object.assign(failure, { code });
      expect(
        await saveWithRetry({
          what: "The record",
          kind: "file",
          path,
          write: async (given) => {
            written.push(given);
            throw failure;
          },
          checkName: async () => {
            throw new Error("Skipping must not ask for another path.");
          },
        }),
      ).toBeUndefined();
    }
    expect(written).toEqual([path, path]);
    expect(output.join(" ")).toContain(`public-${shown}-record.txt`);
    expect(output.every((line) => !line.includes(raw))).toBe(true);
  },
);

it.each(CONTROLS)(
  "keeps owned warning/error styling but never executes %s from a path",
  (_, raw, shown) => {
    vi.stubEnv("NO_COLOR", undefined);
    vi.stubEnv("CLICOLOR_FORCE", "1");
    streamsAsTerminal();
    terminalFailure(`The file public-${raw}-record.txt could not be read.`);
    expect(output.join(" ")).toContain("\x1b[1;31m");
    expect(output.join(" ")).not.toContain(raw);
    const plain = output.map(stripVTControlCharacters).join(" ");
    expect(plain).toContain(`public-${shown}-record.txt`);
    expect(plain).not.toContain(raw);
  },
);

it.each(CONTROLS)(
  "keeps %s out of staging/cloud warnings without changing retained paths",
  async (_, raw, shown) => {
    const path = `/public/Dropbox/public-${raw}-record.txt`;
    const staging = `${path}.staging`;
    const error = new LeftStagingCopyError(path, staging, new Error("Synthetic cleanup failure."));
    await writeSaved(async () => {
      throw error;
    });
    warnOfCloudCopy(path);
    expect(error.saved).toBe(path);
    expect(error.staging).toBe(staging);
    expect(output.join(" ")).toContain(`public-${shown}-record.txt`);
    expect(output.every((line) => !line.includes(raw))).toBe(true);
  },
);

it("keeps ordinary path spelling and the established save-failure text", async () => {
  PrivateSteps.open(
    () => undefined,
    () => undefined,
  );
  keyboard.bytes = [ESCAPE.charCodeAt(0)];
  await saveWithRetry({
    what: "The record",
    kind: "file",
    path: "public ordinary.txt",
    write: async () => {
      throw Object.assign(new Error("Synthetic write denied."), { code: "EACCES" });
    },
    checkName: async () => {
      throw new Error("Skipping must not ask for another path.");
    },
  });
  // On a terminal the notice is wrapped beside its mark (AUD-037-UI006): read as one text.
  expect(output.join(" ").replace(/\s+/gu, " ")).toContain(
    "The record could not be saved as public ordinary.txt: there is no permission to write there.",
  );
});
