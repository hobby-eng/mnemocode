import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { STYLE_CODES } from "../src/cli/terminal-style.js";
import { describe, expect, it } from "vitest";
import { decodeQrPngFile } from "../src/cli/qr-input.js";
import { containing, matching } from "./helpers/matchers.js";
import { runBuiltCli as run } from "./helpers/built-cli.js";

/** The limit of the one test that starts the command line fifteen times. */
const FIFTEEN_STARTS_TIME_LIMIT_MS = 300_000;

const mnemonic =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("CLI records", () => {
  it("reports the package version through both CLI forms", async () => {
    for (const argument of ["--version", "version"]) {
      const result = await run([argument]);
      expect(result.stdout).toBe("mnemocode 0.1.0\n");
      expect(result.stderr).toBe("");
    }
    await expect(run(["--version", "extra"])).rejects.toMatchObject({
      stderr: containing("The version command does not accept additional arguments."),
    });
  });

  it("runs the extended self-test and reports its coverage", async () => {
    const result = await run(["self-test"]);
    expect(result.stdout).toContain("MnemoCode 0.1.0 self-test");
    expect(result.stdout).toContain("Public vectors");
    expect(result.stdout).toContain("Representation matrix");
    expect(result.stdout).toContain("QR adapter");
    expect(result.stdout).toContain("PASS");
    expect(result.stdout).toContain("Card export assets");
    // The checks of the library's features and of those the command line builds in.
    for (const row of [
      "BIP39 seed",
      "Dates",
      "Backup reading",
      "Word search",
      "Share repair",
      "Share unmasking",
      "Wallet evidence",
      "Coin addresses",
      "Heir sheet",
      "Share cards",
      "QR beside sheets",
    ])
      expect(result.stdout).toContain(row);
  });

  it("writes a self-describing record and decodes it without mode or format flags", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-cli-"));
    const path = join(directory, "record.txt");
    try {
      await run([
        "encode",
        "--mode",
        "direct",
        "--mnemonic",
        mnemonic,
        "--format",
        "3",
        "--output",
        path,
      ]);
      expect(await readFile(path, "utf8")).toMatch(/^MNC1:direct:unicode:/u);
      const decoded = await run(["decode", "--input-file", path]);
      expect(decoded.stdout.trim()).toBe(mnemonic);
      expect(decoded.stderr).toContain("BIP39 checksum: valid");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("always prints encode output and rejects a bare --output option", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-output-"));
    const path = join(directory, "record.txt");
    try {
      const encoded = await run([
        "encode",
        "--mnemonic",
        mnemonic,
        "--format",
        "1",
        "--output",
        path,
      ]);
      expect(encoded.stdout).toContain("English BIP39 words of");
      expect(encoded.stdout).toContain(mnemonic);
      expect(await readFile(path, "utf8")).toMatch(/^MNC1:direct:english:/u);
      await expect(
        run(["encode", "--mnemonic", mnemonic, "--format", "1", "--output"]),
      ).rejects.toMatchObject({
        stderr: containing("output record file setting requires a value"),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("CLI records", () => {
  it("lists approved collections and validates preview arguments", async () => {
    const listed = await run(["preview", "--list"]);
    expect(listed.stdout).toContain("business-architect");
    expect(listed.stdout).toContain("business-it");
    const rows = listed.stdout.trimEnd().split("\n");
    expect(rows).toHaveLength(13);
    // Number, id, name and description; --template takes the number as well as the id.
    expect(rows.every((row) => /^ ?\d+ {2}\S+ {3,}.+? {3,}.+$/u.test(row))).toBe(true);
    expect(rows.map((row) => Number(row.trim().split(" ")[0]))).toEqual(
      Array.from({ length: 13 }, (_, index) => index + 1),
    );
    // The names start in one column; the forms that every design prints are named once, above.
    expect(new Set(rows.map((row) => row.search(/(?<=\S {3,})\S/u))).size).toBe(1);
    // The facts above the list on a terminal only, as every result's (terminalResultHeader): a pipe
    // keeps the plain list, also with colour forced (AUD-037-UI006).
    const colored = Object.entries(process.env).filter(
      ([name]) => !["NO_COLOR", "FORCE_COLOR", "CLICOLOR"].includes(name),
    );
    const shown = await run(["preview", "--list"], {
      ...Object.fromEntries(colored),
      CLICOLOR_FORCE: "1",
    });
    expect(shown.stdout).not.toMatch(/Prints/u);
    expect(shown.stdout.replace(STYLE_CODES, "")).toBe(listed.stdout);
    await expect(
      run(["preview", "--all", "--template", "1", "--pdf", "unused.pdf"]),
    ).rejects.toMatchObject({
      stderr: containing("either all templates or one specific template"),
    });
    await expect(run(["preview", "--template", "1"])).rejects.toMatchObject({
      stderr: containing("To save a preview, provide"),
    });
  });

  it("rejects unknown or unavailable templates before prompting or creating files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-pending-design-"));
    const path = join(directory, "keep.pdf");
    const record = join(directory, "keep.txt");
    try {
      await writeFile(path, "existing PDF");
      await writeFile(record, "existing record");
      for (const args of [
        ["preview", "--template", "not-installed", "--pdf", path],
        ["preview", "--template", "new-design", "--title", "Title", "--pdf", path],
        [
          "encode",
          "--ask-secrets",
          "--format",
          "5",
          "--template",
          "not-installed",
          "--pdf",
          path,
          "--output",
          record,
        ],
        [
          "encode",
          "--mode",
          "seedshift",
          "--mnemonic",
          mnemonic,
          "--dates",
          "23-09-2026",
          "--format",
          "3",
          "--template",
          "new-design",
          "--title",
          "Notes",
          "--pdf",
          path,
        ],
      ]) {
        await expect(run(args)).rejects.toMatchObject({
          // Unicode codes (format 3) have no cards: refused before any file is made.
          stderr: matching(
            /No installed card template|unknown or incompatible|Card export requires format/iu,
          ),
        });
      }
      expect(await readFile(path, "utf8")).toBe("existing PDF");
      expect(await readFile(record, "utf8")).toBe("existing record");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("CLI records", () => {
  it("stores only the raw encoded representation in a generated QR", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-raw-qr-"));
    const path = join(directory, "palette.png");
    try {
      const encoded = await run([
        "encode",
        "--mode",
        "seedshift",
        "--mnemonic",
        mnemonic,
        "--dates",
        "23-09-2026",
        "--format",
        "5",
        "--qr",
        path,
      ]);
      const raw = encoded.stdout.trim().split("\n").at(-1)!;
      const qr = await decodeQrPngFile(path);
      expect(qr).toBe(raw);
      expect(qr).not.toContain("MNC1");
      expect(qr).not.toContain("seedshift");
      const decoded = await run(["decode", "--qr-file", path, "--dates", "23-09-2026"]);
      expect(decoded.stdout.trim()).toBe(mnemonic);
      expect(decoded.stderr).toContain("Detected input format: colors.");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps legacy raw records readable with explicit mode and format", async () => {
    const encoded = await run([
      "encode",
      "--mode",
      "seedshift",
      "--mnemonic",
      mnemonic,
      "--dates",
      "10-07-1963",
      "--format",
      "2",
    ]);
    const raw = encoded.stdout.trim().split("\n").at(-1)!;
    const decoded = await run([
      "decode",
      "--mode",
      "seedshift",
      "--input",
      raw,
      "--dates",
      "10-07-1963",
      "--format",
      "2",
    ]);
    expect(decoded.stdout.trim()).toBe(mnemonic);
  });
});

describe("CLI records", () => {
  // It starts the command line once per representation; process start-up is slow on Windows
  // and on a busy or hot machine. Fifteen starts take minutes there, so it has a limit of its own.
  it(
    "auto-detects every representation that encode can produce",
    async () => {
      const formats = [
        ["english", "1"],
        ["indexes", "2"],
        ["unicode", "3"],
        ["colors-unicode", "4"],
        ["colors", "5"],
      ] as const;
      for (const [format, number] of formats) {
        const encoded = await run([
          "encode",
          "--mode",
          "direct",
          "--mnemonic",
          mnemonic,
          "--format",
          number,
        ]);
        const raw = encoded.stdout.trim().split("\n").at(-1)!;
        const decoded = await run(["decode", "--mode", "direct", "--input", raw]);
        expect(decoded.stdout.trim()).toBe(mnemonic);
        expect(decoded.stderr).toContain(`Detected input format: ${format}.`);
        const explicit = await run([
          "decode",
          "--mode",
          "direct",
          "--input",
          raw,
          "--format",
          format,
        ]);
        expect(explicit.stdout.trim()).toBe(mnemonic);
      }
      await expect(
        run(["encode", "--mode", "direct", "--mnemonic", mnemonic, "--format", "6"]),
      ).rejects.toMatchObject({
        stderr: containing("The representation format must be one of"),
      });
    },
    FIFTEEN_STARTS_TIME_LIMIT_MS,
  );

  it("keeps an explicit raw format authoritative", async () => {
    const encoded = await run([
      "encode",
      "--mode",
      "direct",
      "--mnemonic",
      mnemonic,
      "--format",
      "2",
    ]);
    const raw = encoded.stdout.trim().split("\n").at(-1)!;
    const decoded = await run([
      "decode",
      "--mode",
      "direct",
      "--input",
      raw,
      "--format",
      "indexes",
    ]);
    expect(decoded.stdout.trim()).toBe(mnemonic);
    expect(decoded.stderr).not.toContain("Detected input format:");
  });

  it("does not guess an unknown representation in a non-interactive process", async () => {
    await expect(
      run(["decode", "--mode", "direct", "--input", "not a recorded representation"]),
    ).rejects.toMatchObject({
      // The library's reason, as the screen gives it for typed codes (S003: BackupReading).
      stderr: containing("Enter 12, 15, 18, 21 or 24 English BIP39 words."),
    });
  });
});

describe("CLI records", () => {
  it("does not guess between multiple valid raw representations in a non-interactive process", async () => {
    const ambiguous = "76 84 57 28 90 19 59 27 62 11 89 81 66 42 75 28 50 11 52 30 57 30 62 10";
    await expect(run(["decode", "--mode", "direct", "--input", ambiguous])).rejects.toMatchObject({
      stderr: containing("matches several formats (indexes, unicode)"),
    });
  });

  it("rejects explicit mode and format values that conflict with an MNC1 header", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-conflict-"));
    const path = join(directory, "record.txt");
    try {
      await run([
        "encode",
        "--mode",
        "direct",
        "--mnemonic",
        mnemonic,
        "--format",
        "3",
        "--output",
        path,
      ]);
      await expect(
        run(["decode", "--input-file", path, "--format", "colors"]),
      ).rejects.toMatchObject({
        stderr: containing("The record holds unicode codes, not colors."),
      });
      await expect(
        run(["decode", "--input-file", path, "--mode", "seedshift", "--dates", "23-09-2026"]),
      ).rejects.toMatchObject({
        stderr: containing("The record was made with no Seedshift, not with MnemoCode Seedshift."),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("trusts an MNC1 format header only after the declared payload parser validates it", async () => {
    await expect(
      run(["decode", "--input", `MNC1:direct:unicode:${mnemonic}`]),
    ).rejects.toMatchObject({
      // The one message of the Unicode reader (S011).
      stderr: containing("Unicode codes have four hexadecimal digits each"),
    });
    await expect(run(["decode", "--input", "MNC1:direct:unicode:"])).rejects.toMatchObject({
      stderr: containing("Malformed MnemoCode record header"),
    });
  });

  it("auto-detects the raw representation in recover-date as well as decode", async () => {
    const encoded = await run([
      "encode",
      "--mode",
      "seedshift-legacy",
      "--mnemonic",
      mnemonic,
      "--dates",
      "10-07-1963",
      "--format",
      "colors",
    ]);
    const raw = encoded.stdout.trim().split("\n").at(-1)!;
    const recovered = await run([
      "recover-date",
      "--mode",
      "seedshift-legacy",
      "--input",
      raw,
      "--dates",
      "??-07-1963",
      "--max-results",
      "100",
      "--progress-every",
      "1000",
    ]);
    expect(recovered.stderr).toContain("Detected input format: colors.");
    expect(recovered.stdout).toContain(`10-07-1963\t${mnemonic}`);
  });
});

describe("CLI records", () => {
  it("shows a legacy checksum-word suggestion and self-describes an applied replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-legacy-valid-"));
    const path = join(directory, "record.txt");
    try {
      const suggestion = await run([
        "encode",
        "--mode",
        "seedshift-legacy",
        "--mnemonic",
        mnemonic,
        "--dates",
        "23-09-2026",
        "--format",
        "1",
      ]);
      expect(suggestion.stderr).toContain("Optional checksum-valid final word:");
      await run([
        "encode",
        "--mode",
        "seedshift-legacy",
        "--legacy-valid-last-word",
        "--mnemonic",
        mnemonic,
        "--dates",
        "23-09-2026",
        "--format",
        "1",
        "--output",
        path,
      ]);
      expect(await readFile(path, "utf8")).toMatch(/^MNC1:seedshift-legacy-valid:english:/u);
      const recovered = await run(["decode", "--input-file", path, "--dates", "23-09-2026"]);
      expect(recovered.stdout).toContain(mnemonic);
      expect(recovered.stderr).toContain("128 checksum-valid candidates");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("saves the QR code of a sheet beside its PDF in every form whose sheet prints one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mnemocode-sheet-qr-"));
    try {
      // Unicode codes (3), Color Unicode (4) and colors (5), the forms of cards: each sheet prints
      // the encoded text.
      for (const format of ["3", "4", "5"]) {
        const pdf = join(directory, `cards-${format}.pdf`);
        const encoded = await run([
          "encode",
          "--mode",
          "direct",
          "--mnemonic",
          mnemonic,
          "--format",
          format,
          "--pdf",
          pdf,
          "--card-qr",
        ]);
        const raw = encoded.stdout.trim().split("\n").at(-1)!;
        expect(await decodeQrPngFile(join(directory, `cards-${format}-qr.png`)), format).toBe(raw);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
