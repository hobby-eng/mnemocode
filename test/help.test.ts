import { describe, expect, it, vi } from "vitest";
import { flagOf } from "../src/cli/arguments.js";
import { COMMAND_OPTIONS, isCommandName } from "../src/cli/command-options.js";
import { COMMAND_HELP, TOPIC_HELP } from "../src/cli/help-pages.js";
import { printCommandHelp, printNamedHelp } from "../src/cli/usage.js";
import { runCommandLine } from "../src/cli/command-line.js";
import { STYLE, STYLE_CODES } from "../src/cli/terminal-style.js";
import { QUESTION_HOURS } from "../src/core/search-turns.js";
import { DEFAULT_ADDRESS_COUNT } from "../src/core/address-scan.js";
import { MAX_JOINT_MARKED_ELEMENTS } from "../src/sskr/joint-repair.js";
import { MIN_THRESHOLD, MAX_SHARES } from "../src/sskr/split.js";
import { MAX_SHOWN_MATCHES } from "../src/core/date-search.js";
import { MIN_LIST_PASSPHRASE_LENGTH } from "../src/core/candidate-encryption.js";
import { COINS } from "../src/core/coins.js";
import { MASKING_MODES } from "../src/core/types.js";
import { MAX_SEARCH_COMBINATIONS, MAX_SHOWN_CANDIDATES } from "../src/core/candidates.js";
import { counting } from "../src/core/search-plan.js";
import {
  BITCOIN_PROFILES,
  BITCOIN_NETWORKS,
  extendedPublicKeyPrefixes,
} from "../src/core/wallet-evidence.js";
import { containing } from "./helpers/matchers.js";
import { runBuiltCli as run } from "./helpers/built-cli.js";

describe("help", () => {
  it("documents exactly the options each command accepts", () => {
    for (const name of Object.keys(COMMAND_OPTIONS).filter(isCommandName)) {
      const documented = COMMAND_HELP[name].groups.flatMap((group) =>
        group.options.map((option) => option.flag),
      );
      // Each parser key as it is typed, "--dates" for "date" (flagOf).
      const accepted = COMMAND_OPTIONS[name].map((key) => flagOf(key));
      expect([...new Set(documented)].sort(), name).toEqual([...accepted].sort());
    }
  });

  it("says which mode sskr-split takes without --mode, and that a share's decoy card is not needed", () => {
    const mode = COMMAND_HELP["sskr-split"].groups
      .flatMap((group) => group.options)
      .find((option) => option.flag === "--mode");
    expect(mode?.summary).toBe("direct or seedshift; see mnemocode help modes");
    expect(mode?.details).toEqual([
      "Without --mode, MnemoCode uses seedshift when --dates-file is given and direct otherwise.",
    ]);
    expect(COMMAND_HELP["sskr-combine"].notes?.[0]).toBe(
      "Every real card of one share is needed, in numbered order, to rebuild that share; its last card is a decoy and may be left out.",
    );
  });

  it("lists every command but sskr-split, and every topic, in the overview", async () => {
    for (const argument of [[], ["--help"], ["-h"], ["help"]]) {
      const { stdout } = await run(argument);
      expect(stdout).toContain("MnemoCode 0.1.0");
      for (const name of Object.keys(COMMAND_OPTIONS).filter((item) => item !== "sskr-split"))
        expect(stdout).toContain(`  ${name}`);
      for (const topic of Object.keys(TOPIC_HELP)) expect(stdout).toContain(`help ${topic}`);
      expect(stdout).toContain("Recovery material:");
      // AUD-005-UI002: the overview, including its safety line, fits the 80-column help width.
      for (const line of stdout.split("\n")) expect(line.length, line).toBeLessThanOrEqual(80);
    }
  });

  it("keeps every help page within 80 columns, the phrase of the examples aside", () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((text: string) => {
      lines.push(...text.split("\n"));
    });
    try {
      for (const name of [...Object.keys(COMMAND_HELP), ...Object.keys(TOPIC_HELP)])
        expect(printNamedHelp(name), name).toBe(true);
      for (const name of Object.keys(COMMAND_HELP).filter(isCommandName))
        printCommandHelp(name, false);
    } finally {
      log.mockRestore();
    }
    // AUD-037-UI008: a heading is wrapped like the rest; only the test phrase cannot be split.
    // Measured as shown: colour codes, which CLICOLOR_FORCE may add, take no column.
    for (const line of lines.map((text) => text.replace(STYLE_CODES, "")))
      if (!line.trimStart().startsWith("TEST_PHRASE="))
        expect(line.length, line).toBeLessThanOrEqual(80);
  });

  it("prints the help of version and of help", async () => {
    const pages = new Map<string, string>();
    for (const arguments_ of [
      ["help", "version"],
      ["version", "--help"],
      ["version", "-h"],
      ["-V", "--help"],
      ["--version", "-h"],
      ["help", "help"],
      ["help", "--help"],
      ["help", "-h"],
    ]) {
      const lines: string[] = [];
      const log = vi.spyOn(console, "log").mockImplementation((text: string) => lines.push(text));
      try {
        await runCommandLine(arguments_);
      } finally {
        log.mockRestore();
      }
      pages.set(arguments_.join(" "), lines.join("\n"));
    }
    expect(pages.get("help version")).toContain("Usage: mnemocode version");
    expect(pages.get("version --help")).toBe(pages.get("help version"));
    expect(pages.get("version -h")).toBe(pages.get("help version"));
    expect(pages.get("-V --help")).toBe(pages.get("help version"));
    expect(pages.get("--version -h")).toBe(pages.get("help version"));
    expect(pages.get("help help")).toContain("Usage: mnemocode help [<COMMAND|TOPIC>]");
    expect(pages.get("help --help")).toBe(pages.get("help help"));
    expect(pages.get("help -h")).toBe(pages.get("help help"));
  });

  it("prints the help without a command when there is no terminal for the menu", async () => {
    const { stdout } = await run([]);
    expect(stdout).toContain("Usage: mnemocode <COMMAND> [OPTIONS]");
    expect(stdout).toContain("shows a menu");
  });

  it("gives a summary with -h and the full explanation with --help", async () => {
    const short = await run(["encode", "-h"]);
    const long = await run(["encode", "--help"]);
    const named = await run(["help", "encode"]);
    expect(named.stdout).toBe(long.stdout);
    expect(short.stdout).toContain("--legacy-valid-last-word");
    expect(short.stdout).not.toContain("macOS and Windows alike");
    expect(long.stdout).toContain("macOS and Windows alike");
    expect(long.stdout).toContain("TEST_PHRASE='abandon abandon");
    expect(long.stdout).toContain("mnemocode encode --sskr --ask-secrets --threshold 2 --shares 3");
  });

  it("answers a help request on a half-typed command without running it", async () => {
    const { stdout } = await run(["decode", "--input-file", "unfinished", "--help"]);
    expect(stdout).toContain("Usage: mnemocode decode");
  });

  it("prints a topic", async () => {
    const { stdout } = await run(["help", "formats"]);
    expect(stdout).toContain("colors-unicode");
  });

  it("refuses an unknown command or topic without repeating it", async () => {
    for (const [typed, refusal] of [
      [["frobnicate"], "There is no such command."],
      [["help", "frobnicate"], "There is no such command or topic."],
    ] as const) {
      const failure: unknown = await run([...typed]).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toMatchObject({ code: 1, stderr: containing(refusal) });
      expect(failure).not.toMatchObject({ stderr: containing("frobnicate") });
    }
  });
});

describe("help notes and the cards they describe", () => {
  it("prints a topic's notes grey, after its examples and before the safety line", () => {
    vi.stubEnv("CLICOLOR_FORCE", "1");
    vi.stubEnv("NO_COLOR", "");
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((text: string) => {
      lines.push(...text.split("\n"));
    });
    try {
      printNamedHelp("formats");
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
    const plain = lines.map((line) => line.replace(STYLE_CODES, ""));
    const note = plain.findIndex((line) => line.startsWith("Every format is a representation"));
    expect(note).toBeGreaterThan(plain.indexOf("Examples:"));
    expect(note).toBeLessThan(plain.findIndex((line) => line.startsWith("Recovery material:")));
    expect(plain).not.toContain("Notes:");
    // Grey, as a command's notes are (CORE-35, CORE-37).
    expect(lines[note]?.startsWith(`\x1b[${STYLE.muted}m`)).toBe(true);
  });

  it("says that only the real cards are needed, on no page that every card is, and that each share file holds one share", () => {
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((text: string) => {
      lines.push(...text.split("\n"));
    });
    try {
      for (const name of [...Object.keys(COMMAND_HELP), ...Object.keys(TOPIC_HELP)])
        printNamedHelp(name);
    } finally {
      log.mockRestore();
    }
    // Separate cards end with a decoy (INDIVIDUAL_DECOYS), which no restore needs.
    const text = lines.join(" ").replace(/\s+/gu, " ");
    expect(text).not.toMatch(/every card (of a share )?is needed/iu);
    expect(text).toContain(
      "every real card is needed, and each reveals a part of the encoded phrase",
    );
    expect(text).toContain("Every real card is needed to recover the phrase");
    // The commands of shares save one share in each file or folder of --cards-dir.
    for (const command of ["sskr-split", "sskr-export"] as const) {
      const options = COMMAND_HELP[command].groups.flatMap((group) => group.options);
      const option = (flag: string) => options.find((each) => each.flag === flag);
      expect(option("--cards-dir")?.details, command).toEqual([
        "Each file or folder holds one share: keep them in different places. A taken name is numbered, never replaced.",
      ]);
      expect(option("--card-qr")?.summary, command).toBe(
        "Add a QR code of its own share to each collection sheet",
      );
      expect(option("--image-format")?.details?.[0], command).not.toContain("one PDF per card;");
    }
  });
});

describe("links to the README", () => {
  it("point only to headings that the README has", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    // GitHub's anchor of a heading: lower case, spaces as hyphens, other punctuation dropped.
    const anchors = new Set(
      (await readFile("README.md", "utf8"))
        .split("\n")
        .filter((line) => /^#{1,6} /u.test(line))
        .map((line) =>
          line
            .replace(/^#+ /u, "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N} -]/gu, "")
            .replaceAll(" ", "-"),
        ),
    );
    const used = new Set<string>();
    for (const file of await readdir("src/cli")) {
      const source = await readFile(`src/cli/${file}`, "utf8");
      for (const match of source.matchAll(/(?:readmeLink|terminalMore)\("([^"]+)"\)/gu))
        used.add(match[1]!);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const anchor of used) expect(anchors, anchor).toContain(anchor);
  });
});

describe("S051: the numbers of the help come from the constants that own them", () => {
  it("says the limits and defaults as the library holds them", () => {
    const text = JSON.stringify([COMMAND_HELP, TOPIC_HELP]);
    for (const value of [
      `up to ${QUESTION_HOURS} hours`,
      `default ${DEFAULT_ADDRESS_COUNT}`,
      `up to ${MAX_JOINT_MARKED_ELEMENTS} on one share`,
      `at least ${MIN_THRESHOLD}`,
      `N to ${MAX_SHARES}`,
      `default ${MAX_SHOWN_MATCHES}`,
      `${MIN_LIST_PASSPHRASE_LENGTH} characters or more`,
      `up to ${counting(MAX_SEARCH_COMBINATIONS)}`,
      `More than ${counting(MAX_SHOWN_CANDIDATES)} candidates are not shown`,
    ])
      expect(text).toContain(value);
  });
});

describe("S052: the help names every coin, mode and profile of the library", () => {
  it("leaves none of them out", () => {
    const text = JSON.stringify([COMMAND_HELP, TOPIC_HELP]);
    for (const name of [
      ...COINS.map((coin) => coin.name),
      ...MASKING_MODES,
      ...BITCOIN_PROFILES,
      ...BITCOIN_NETWORKS.flatMap(extendedPublicKeyPrefixes),
    ])
      expect(text, name).toContain(name);
  });
});
