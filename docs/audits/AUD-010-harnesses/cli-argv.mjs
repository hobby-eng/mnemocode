// AUD-010 cli reviewer: the command line without a terminal (standard input from /dev/null, output
// to pipes), through the production entry src/mnemocode.ts run by Node.js with this checkout's tsx
// loader, each case in a fresh scratch folder under bip_tools/tmp/mnemocode/aud010/cli/argv/.
//
//   node docs/audits/AUD-010-harnesses/run-command.mjs cli-argv \
//       node docs/audits/AUD-010-harnesses/cli-argv.mjs [group ...]
//
// Groups: screen (options that only answer decode --ask-secrets), mixing (--ask-secrets with a
// secret on the command line), parsing (duplicates, unknown, missing values, flags, --scan-gap
// bounds, conflicts), outputs (nothing partial, numbered names, README defaults), echo (refusals do
// not repeat secret input), defects (cases whose expected result comes from the contract of the
// other commands and that currently differ; reported as findings).
//
// Every case checks its exit code and stderr text, that a refusal prints nothing on stdout, that no
// output carries an ANSI escape (piped output must be plain), that no stack trace is printed, and
// that the scratch folder holds exactly the files expected afterwards. Only public fixtures: the
// BIP39 test phrase, its README masking with 23-09-2026, shares of verify-terminal-input.py.

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../../..");
const SOURCE = join(ROOT, "src/mnemocode.ts");
const TSX = pathToFileURL(join(ROOT, "node_modules/tsx/dist/loader.mjs")).href;
const WORK = fileURLToPath(new URL("../../../../tmp/mnemocode/aud010/cli/argv", import.meta.url));

const P11 = Array(11).fill("abandon").join(" ");
const PHRASE = `${P11} about`;
const MASKED = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
const SHARE = "ur:sskr/gomuttaeadaernclmdemdtlftsswsospsrjnjpwzuetlfhdltahh";
const ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
const ETH = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const NO_TERMINAL =
  "mnemocode: --ask-secrets needs a terminal on standard input and standard error. Run the command in a terminal, or read the secret from a protected local file (--mnemonic-file, --input-file or --share-file) or from standard input (-).";
const SCAN_GAP_BOUNDS =
  "mnemocode: The number of addresses scanned value must be a base-10 integer from 1 through 1000.";
const ON_OR_OFF = (label) =>
  `mnemocode: The ${label} setting is an on-or-off choice and does not accept a separate value.`;
const RECOVER_DATE = ["recover-date", "--mode", "seedshift", "--input", MASKED, "--format", "1"];
const RECOVER_LEGACY = ["recover-date", "--mode", "seedshift-legacy", "--input", MASKED];

/** The options that decode refuses without --ask-secrets (decode-command.ts SCREEN_ANSWERS). */
const SCREEN_ANSWERS = [
  ["scan-gap", "20"],
  ["bitcoin-address", ADDRESS],
  ["coin-address", ETH],
  ["coin", "ethereum"],
  ["master-xpub", "xpub-not-read"],
  ["account-xpub", "zpub-not-read"],
  ["compressed-public-key", "03cc"],
  ["master-fingerprint", "73c5da0a"],
  ["wif-file", "missing-wif.txt"],
  ["network", "testnet"],
  ["bitcoin-profile", "taproot"],
  ["account", "0"],
  ["branch", "0"],
  ["index", "0"],
  ["bip39-passphrase-file", "missing-passphrase.txt"],
  ["encoded-fingerprint", "0d05289e"],
  ["list-candidates"],
  ["max-candidates", "10"],
  ["max-results", "10"],
  ["max-tries", "10"],
  ["input-kind", "codes"],
];

const cases = [];
const add = (group, name, args, expect) => cases.push({ group, name, args, ...expect });

// screen: the phrase must not be decoded and shown when such an option is given.
for (const [key, value] of SCREEN_ANSWERS)
  add(
    "screen",
    `decode --${key} without --ask-secrets`,
    [
      "decode",
      "--mode",
      "seedshift",
      "--input",
      MASKED,
      "--format",
      "1",
      "--dates",
      "23-09-2026",
      `--${key}`,
      ...(value === undefined ? [] : [value]),
    ],
    {
      exit: 1,
      stderr: `mnemocode: --${key} answers a question of decode --ask-secrets, where the dates or the codes may hold ?.`,
    },
  );

// mixing
const ENCODE_MIX =
  "mnemocode: --ask-secrets cannot be combined with a mnemonic supplied on the command line, a mnemonic file, or command-line dates.";
const CODES_MIX =
  "mnemocode: --ask-secrets cannot be combined with direct encoded text or command-line dates.";
add(
  "mixing",
  "encode --ask-secrets --mnemonic",
  ["encode", "--ask-secrets", "--mnemonic", PHRASE],
  { exit: 1, stderr: ENCODE_MIX },
);
add(
  "mixing",
  "encode --ask-secrets --mnemonic-file",
  ["encode", "--ask-secrets", "--mnemonic-file", "m.txt"],
  { exit: 1, stderr: ENCODE_MIX, files: { "m.txt": PHRASE } },
);
add(
  "mixing",
  "encode --ask-secrets --dates",
  ["encode", "--ask-secrets", "--dates", "23-09-2026"],
  { exit: 1, stderr: ENCODE_MIX },
);
add(
  "mixing",
  "sskr-split --ask-secrets --mnemonic",
  ["sskr-split", "--ask-secrets", "--threshold", "2", "--shares", "3", "--mnemonic", PHRASE],
  { exit: 1, stderr: ENCODE_MIX },
);
add("mixing", "decode --ask-secrets --input", ["decode", "--ask-secrets", "--input", MASKED], {
  exit: 1,
  stderr: CODES_MIX,
});
add(
  "mixing",
  "decode --ask-secrets --dates",
  ["decode", "--ask-secrets", "--mode", "seedshift", "--dates", "23-09-2026"],
  { exit: 1, stderr: CODES_MIX },
);
add(
  "mixing",
  "recover-date --ask-secrets --input",
  ["recover-date", "--ask-secrets", "--mode", "seedshift", "--input", MASKED],
  { exit: 1, stderr: CODES_MIX },
);
add(
  "mixing",
  "recover-date --ask-secrets --dates",
  ["recover-date", "--ask-secrets", "--mode", "seedshift", "--dates", "??-09-2026"],
  { exit: 1, stderr: CODES_MIX },
);
add(
  "mixing",
  "recover-word --ask-secrets --mnemonic",
  ["recover-word", "--ask-secrets", "--mnemonic", `${P11} ?`],
  {
    exit: 1,
    stderr:
      "mnemocode: --ask-secrets cannot be combined with direct mnemonic text or a mnemonic file.",
  },
);
add(
  "mixing",
  "sskr-combine --ask-secrets --share",
  ["sskr-combine", "--ask-secrets", "--share", SHARE],
  {
    exit: 1,
    stderr: "mnemocode: --ask-secrets cannot be combined with another share-input source.",
  },
);
add(
  "mixing",
  "sskr-export --ask-secrets --share",
  ["sskr-export", "--ask-secrets", "--share", SHARE],
  {
    exit: 1,
    stderr: "mnemocode: --ask-secrets cannot be combined with another share-input source.",
  },
);
for (const command of ["encode", "decode", "recover-word", "sskr-combine", "sskr-export"])
  add("mixing", `${command} --ask-secrets without a terminal`, [command, "--ask-secrets"], {
    exit: 1,
    stderr: NO_TERMINAL,
  });
add(
  "mixing",
  "recover-date --ask-secrets without a terminal",
  ["recover-date", "--ask-secrets", "--mode", "seedshift"],
  { exit: 1, stderr: NO_TERMINAL },
);

// parsing
add("parsing", "duplicate --input", ["decode", "--input", "a", "--input", "b"], {
  exit: 1,
  stderr: "mnemocode: Provide only one value for the encoded text setting.",
});
add(
  "parsing",
  "duplicate --mode",
  ["decode", "--mode", "direct", "--mode", "seedshift", "--input", MASKED],
  { exit: 1, stderr: "mnemocode: Provide only one value for the transformation mode setting." },
);
add(
  "parsing",
  "duplicate --scan-gap",
  [
    ...RECOVER_DATE,
    "--dates",
    "??-09-2026",
    "--bitcoin-address",
    ADDRESS,
    "--scan-gap",
    "5",
    "--scan-gap",
    "6",
  ],
  {
    exit: 1,
    stderr: "mnemocode: Provide only one value for the number of addresses scanned setting.",
  },
);
add("parsing", "unknown option", ["decode", "--bogus", "1"], {
  exit: 1,
  stderr: "mnemocode: The decode command does not support the bogus setting.",
});
add("parsing", "missing value at the end", ["decode", "--input"], {
  exit: 1,
  stderr: "mnemocode: The encoded text setting requires a value.",
});
add("parsing", "missing value before an option", ["decode", "--input", "--mode", "direct"], {
  exit: 1,
  stderr: "mnemocode: The encoded text setting requires a value.",
});
add("parsing", "unnamed value", ["decode", "stray"], {
  exit: 1,
  stderr:
    "mnemocode: This command does not accept an unnamed value. Use the appropriate named option.",
});
add("parsing", "--ask-secrets yes", ["encode", "--ask-secrets", "yes"], {
  exit: 1,
  stderr: ON_OR_OFF("secret prompt mode"),
});
add(
  "parsing",
  "--legacy-valid-last-word yes",
  ["recover-word", "--legacy-valid-last-word", "yes", "--mnemonic", PHRASE],
  { exit: 1, stderr: ON_OR_OFF("legacy checksum word replacement") },
);
add("parsing", "--list-candidates yes", ["decode", "--ask-secrets", "--list-candidates", "yes"], {
  exit: 1,
  stderr: ON_OR_OFF("listing of every candidate"),
});
for (const bad of ["0", "1001", "01", "1e3", "-1", "20.5", "+5", " 5", "0x10"])
  add(
    "parsing",
    `--scan-gap ${JSON.stringify(bad)}`,
    [...RECOVER_DATE, "--dates", "??-09-2026", "--bitcoin-address", ADDRESS, "--scan-gap", bad],
    { exit: 1, stderr: SCAN_GAP_BOUNDS },
  );
for (const good of ["1", "1000"])
  add("parsing", `--scan-gap ${good} accepted`, ["decode", "--ask-secrets", "--scan-gap", good], {
    exit: 1,
    stderr: NO_TERMINAL,
  });
add(
  "parsing",
  "--scan-gap past the last index",
  [
    ...RECOVER_DATE,
    "--dates",
    "??-09-2026",
    "--bitcoin-address",
    ADDRESS,
    "--index",
    "2147483647",
    "--scan-gap",
    "2",
  ],
  { exit: 1, stderr: "mnemocode: The addresses compared would pass index 2147483647." },
);
add(
  "parsing",
  "--coin without --coin-address",
  [...RECOVER_DATE, "--dates", "??-09-2026", "--coin", "ethereum"],
  { exit: 1, stderr: "mnemocode: --coin names the coin of --coin-address." },
);
add(
  "parsing",
  "--coin-address without --coin",
  [...RECOVER_DATE, "--dates", "??-09-2026", "--coin-address", ETH],
  { exit: 1, stderr: "mnemocode: --coin-address needs --coin, such as --coin ethereum." },
);
add(
  "parsing",
  "two wallet options",
  [
    ...RECOVER_DATE,
    "--dates",
    "??-09-2026",
    "--master-fingerprint",
    "73c5da0a",
    "--bitcoin-address",
    ADDRESS,
  ],
  { exit: 1, stderr: "mnemocode: Select exactly one recovery-evidence option." },
);
add(
  "parsing",
  "--network with a coin address",
  [
    ...RECOVER_DATE,
    "--dates",
    "??-09-2026",
    "--coin",
    "ethereum",
    "--coin-address",
    ETH,
    "--network",
    "testnet",
  ],
  {
    exit: 1,
    stderr: "mnemocode: --network is for Bitcoin evidence; the coin's address tells its own.",
  },
);
add(
  "parsing",
  "--scan-gap with a fingerprint",
  [...RECOVER_DATE, "--dates", "??-09-2026", "--master-fingerprint", "73c5da0a", "--scan-gap", "5"],
  {
    exit: 1,
    stderr:
      "mnemocode: --scan-gap applies to an address, a compressed public key or a WIF, one of several in a row.",
  },
);
add(
  "parsing",
  "--index with a fingerprint",
  [...RECOVER_DATE, "--dates", "??-09-2026", "--master-fingerprint", "73c5da0a", "--index", "1"],
  {
    exit: 1,
    stderr: "mnemocode: --index places an address, a key or a WIF; a master key has no place.",
  },
);
add(
  "parsing",
  "--scan-gap without a wallet or --ask-secrets",
  [...RECOVER_LEGACY, "--format", "1", "--dates", "??-09-2026", "--scan-gap", "5"],
  {
    exit: 1,
    stderr:
      "mnemocode: --scan-gap applies to an address given with an option, or asked on the screen with --ask-secrets.",
  },
);
add(
  "parsing",
  "--network without a wallet, --ask-secrets",
  ["decode", "--ask-secrets", "--network", "testnet"],
  {
    exit: 1,
    stderr:
      "mnemocode: --network applies to a wallet given as an option, such as --bitcoin-address; the wallet asked on the screen is looked for on mainnet among its first receiving addresses.",
  },
);
add(
  "parsing",
  "--list-candidates with a wallet",
  ["decode", "--ask-secrets", "--list-candidates", "--master-fingerprint", "73c5da0a"],
  {
    exit: 1,
    stderr: "mnemocode: --list-candidates lists the candidates instead of a wallet check.",
  },
);
add("parsing", "--input-kind both", ["decode", "--ask-secrets", "--input-kind", "both"], {
  exit: 1,
  stderr: "mnemocode: --input-kind must be codes or share.",
});
add(
  "parsing",
  "--qr-file with --input",
  ["decode", "--qr-file", "q.png", "--input", MASKED, "--mode", "direct"],
  {
    exit: 1,
    stderr: "mnemocode: Choose one encoded input source: a QR image, direct text, or a text file.",
  },
);
add(
  "parsing",
  "--input with --input-file",
  ["decode", "--input", MASKED, "--input-file", "f.txt", "--mode", "direct"],
  {
    exit: 1,
    stderr:
      "mnemocode: Provide the encoded input either as direct text or in a file, but not both.",
    files: { "f.txt": MASKED },
  },
);
// AUD-008-API004 regression: an unknown mode is refused, not read as checksum-valid Seedshift.
const MODES =
  "mnemocode: The transformation mode must be direct, seedshift, seedshift-legacy, or seedshift-legacy-valid.";
add(
  "parsing",
  "recover-date --mode bogus (AUD-008-API004)",
  [
    "recover-date",
    "--mode",
    "bogus",
    "--input",
    MASKED,
    "--format",
    "1",
    "--dates",
    "??-09-2026",
    "--master-fingerprint",
    "73c5da0a",
  ],
  { exit: 1, stderr: MODES },
);
add(
  "parsing",
  "decode --ask-secrets --mode bogus",
  ["decode", "--ask-secrets", "--mode", "bogus"],
  { exit: 1, stderr: MODES },
);
add(
  "parsing",
  "unknown coin",
  [...RECOVER_DATE, "--dates", "??-09-2026", "--coin", "bogus", "--coin-address", "x"],
  { exit: 1, stderrIncludes: 'Unknown coin "bogus"' },
);
add(
  "parsing",
  "address not of the coin",
  [...RECOVER_DATE, "--dates", "??-09-2026", "--coin", "ethereum", "--coin-address", "0x1234"],
  { exit: 1, oneLine: true },
);

// outputs
add(
  "outputs",
  "invalid date: no record file",
  ["encode", "--mnemonic", PHRASE, "--dates", "31-02-2031", "--format", "3", "--output", "rec.txt"],
  { exit: 1, stderr: "mnemocode: The day is outside the selected calendar month.", after: [] },
);
add(
  "outputs",
  "cards in format 1: no folder",
  ["encode", "--mnemonic", PHRASE, "--mode", "direct", "--format", "1", "--cards-dir", "cards"],
  { exit: 1, oneLine: true, after: [] },
);
add(
  "outputs",
  "threshold above count: no share file",
  ["sskr-split", "--mnemonic", PHRASE, "--threshold", "4", "--shares", "3", "--output", "s.txt"],
  { exit: 1, oneLine: true, after: [] },
);
add(
  "outputs",
  "legacy shares: no share file",
  [
    "encode",
    "--sskr",
    "--mnemonic",
    PHRASE,
    "--mode",
    "seedshift-legacy",
    "--dates",
    "23-09-2026",
    "--threshold",
    "2",
    "--shares",
    "3",
    "--output",
    "s.txt",
  ],
  { exit: 1, oneLine: true, after: [] },
);
add(
  "outputs",
  "unknown option: no record file",
  [
    "encode",
    "--mnemonic",
    PHRASE,
    "--mode",
    "direct",
    "--format",
    "3",
    "--output",
    "rec.txt",
    "--scan-gap",
    "5",
  ],
  {
    exit: 1,
    stderr:
      "mnemocode: The encode command does not support the number of addresses scanned setting.",
    after: [],
  },
);
add(
  "outputs",
  "taken name becomes rec-1.txt",
  ["encode", "--mnemonic", PHRASE, "--mode", "direct", "--format", "3", "--output", "rec.txt"],
  {
    exit: 0,
    stderrIncludes: "rec-1.txt",
    files: { "rec.txt": "keep me\n" },
    after: ["rec-1.txt", "rec.txt"],
    unchanged: { "rec.txt": "keep me\n" },
    recordOf: "rec-1.txt",
  },
);
add(
  "outputs",
  "taken names become rec-2.txt",
  ["encode", "--mnemonic", PHRASE, "--mode", "direct", "--format", "3", "--output", "rec.txt"],
  {
    exit: 0,
    stderrIncludes: "rec-2.txt",
    files: { "rec.txt": "keep me\n", "rec-1.txt": "keep me too\n" },
    after: ["rec-1.txt", "rec-2.txt", "rec.txt"],
    unchanged: { "rec.txt": "keep me\n", "rec-1.txt": "keep me too\n" },
    recordOf: "rec-2.txt",
  },
);
add(
  "outputs",
  "README: seedshift by default with --dates",
  ["encode", "--mnemonic", PHRASE, "--dates", "23-09-2026", "--format", "1"],
  { exit: 0, stdoutIncludes: MASKED },
);
add(
  "outputs",
  "README: english words by default",
  ["encode", "--mnemonic", PHRASE, "--mode", "direct"],
  { exit: 0, stdoutIncludes: PHRASE },
);
add(
  "outputs",
  "README: decode a typed masked phrase",
  ["decode", "--mode", "seedshift", "--input", MASKED, "--dates", "23-09-2026"],
  { exit: 0, stdoutIncludes: PHRASE, stderrIncludes: "73c5da0a" },
);
// README "Secret input styles": text input may be up to 1 MiB; MnemoCode refuses larger input.
const MIB = 1024 * 1024;
add(
  "outputs",
  "README: an input file of exactly 1 MiB is read",
  [
    "decode",
    "--mode",
    "seedshift",
    "--format",
    "1",
    "--dates",
    "23-09-2026",
    "--input-file",
    "big.txt",
  ],
  { exit: 0, stdoutIncludes: PHRASE, files: { "big.txt": MASKED.padEnd(MIB, " ") } },
);
add(
  "outputs",
  "README: an input file of 1 MiB + 1 byte is refused",
  [
    "decode",
    "--mode",
    "seedshift",
    "--format",
    "1",
    "--dates",
    "23-09-2026",
    "--input-file",
    "big.txt",
  ],
  {
    exit: 1,
    stderr: "mnemocode: The encoded input file exceeds the 1 MiB safety limit.",
    files: { "big.txt": MASKED.padEnd(MIB + 1, " ") },
  },
);
add(
  "outputs",
  "ETH evidence finds 23-09-2026 (menu-coin equivalent)",
  [
    ...RECOVER_DATE,
    "--dates",
    "??-09-2026",
    "--coin",
    "ethereum",
    "--coin-address",
    ETH,
    "--scan-gap",
    "20",
  ],
  { exit: 0, stdoutIncludes: "23-09-2026" },
);

// echo: refusals name a place, never the typed secret.
add("echo", "mistyped word", ["encode", "--mnemonic", `${P11} abuot`], {
  exit: 1,
  oneLine: true,
  secret: ["abuot", "abandon"],
});
add(
  "echo",
  "mistyped masked word",
  [
    "decode",
    "--mode",
    "seedshift",
    "--format",
    "1",
    "--dates",
    "23-09-2026",
    "--input",
    MASKED.replace("congress", "congresz"),
  ],
  { exit: 1, oneLine: true, secret: ["congresz", "wool"] },
);
add(
  "echo",
  "mistyped date",
  ["decode", "--mode", "seedshift", "--format", "1", "--input", MASKED, "--dates", "23-09-2X31"],
  { exit: 1, oneLine: true, secret: ["2X31"] },
);
add(
  "echo",
  "impossible pattern",
  [...RECOVER_DATE, "--master-fingerprint", "73c5da0a", "--dates", "??-13-2031"],
  { exit: 1, oneLine: true, secret: ["2031"] },
);
add("echo", "damaged share", ["sskr-combine", "--share", SHARE.replace(/h$/u, "z")], {
  exit: 1,
  oneLine: true,
  secret: ["gomutt", "ur:sskr"],
});
add("echo", "unknown word in recover-word", ["recover-word", "--mnemonic", `${P11} zzzzq`], {
  exit: 1,
  oneLine: true,
  secret: ["zzzzq", "abandon"],
});

// defects: expected from the contract of the other commands; they differ today.
add(
  "defects",
  "sskr-combine --ask-secrets --dates (refused by encode, decode, recover-date)",
  ["sskr-combine", "--ask-secrets", "--mode", "seedshift", "--dates", "23-09-2026"],
  { exit: 1, stderrIncludes: "cannot be combined" },
);
add(
  "defects",
  "sskr-export --ask-secrets --dates (refused by encode, decode, recover-date)",
  [
    "sskr-export",
    "--ask-secrets",
    "--mode",
    "seedshift",
    "--dates",
    "23-09-2026",
    "--master-fingerprint",
    "73c5da0a",
  ],
  { exit: 1, stderrIncludes: "cannot be combined" },
);
add("defects", "--missing-word yes", ["recover-word", "--missing-word", "yes", "--mnemonic", P11], {
  exit: 1,
  stderr: ON_OR_OFF("missing word search"),
});
add(
  "defects",
  "--plaintext-candidates yes",
  [
    "recover-word",
    "--mnemonic",
    `${P11} ?`,
    "--candidates-file",
    "c.age",
    "--plaintext-candidates",
    "yes",
  ],
  { exit: 1, stderr: ON_OR_OFF("unencrypted candidates"), after: [] },
);

function run(args, cwd) {
  return new Promise((done) => {
    const env = { ...process.env };
    for (const key of ["NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE"]) delete env[key];
    env.TERM = "xterm-256color";
    const child = spawn(process.execPath, ["--import", TSX, SOURCE, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (bytes) => (stdout += bytes));
    child.stderr.on("data", (bytes) => (stderr += bytes));
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

async function check(item, index) {
  const cwd = join(WORK, String(index).padStart(3, "0"));
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  for (const [name, text] of Object.entries(item.files ?? {})) writeFileSync(join(cwd, name), text);
  const before = readdirSync(cwd).sort();
  const result = await run(item.args, cwd);
  const after = readdirSync(cwd).sort();
  const problems = [];
  const stderr = result.stderr.trimEnd();
  if (result.code !== item.exit) problems.push(`exit ${result.code}, expected ${item.exit}`);
  if (item.stderr !== undefined && stderr !== item.stderr) problems.push(`stderr differs`);
  if (item.stderrIncludes !== undefined && !result.stderr.includes(item.stderrIncludes))
    problems.push(`stderr lacks ${JSON.stringify(item.stderrIncludes)}`);
  if (item.stdoutIncludes !== undefined && !result.stdout.includes(item.stdoutIncludes))
    problems.push(`stdout lacks ${JSON.stringify(item.stdoutIncludes)}`);
  if (item.exit !== 0 && result.stdout !== "") problems.push("a refusal printed on stdout");
  if (item.oneLine && !/^mnemocode: [^\n]+$/u.test(stderr))
    problems.push("not one 'mnemocode:' error line");
  if (/\n\s+at /u.test(result.stderr)) problems.push("stack trace");
  if (/\x1b\[/u.test(result.stdout + result.stderr)) problems.push("ANSI escape in piped output");
  for (const secret of item.secret ?? [])
    if (result.stderr.includes(secret)) problems.push(`stderr repeats ${JSON.stringify(secret)}`);
  const expectedAfter = item.after ?? before;
  if (JSON.stringify(after) !== JSON.stringify([...expectedAfter].sort()))
    problems.push(
      `files after: ${JSON.stringify(after)}, expected ${JSON.stringify(expectedAfter)}`,
    );
  for (const [name, text] of Object.entries(item.unchanged ?? {}))
    if (readFileSync(join(cwd, name), "utf8") !== text) problems.push(`${name} was changed`);
  let record;
  if (item.recordOf !== undefined) {
    record = readFileSync(join(cwd, item.recordOf), "utf8").trim();
    const decoded = await run(["decode", "--input-file", item.recordOf], cwd);
    if (decoded.stdout.trim() !== PHRASE)
      problems.push(`decode of ${item.recordOf} gave ${JSON.stringify(decoded.stdout.trim())}`);
  }
  return { item, result, after, problems, record };
}

const groups = process.argv.slice(2);
const selected = cases.filter((item) => groups.length === 0 || groups.includes(item.group));
const results = [];
const CONCURRENCY = 8;
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < selected.length) {
      const index = next++;
      results[index] = await check(selected[index], index);
    }
  }),
);
let failed = 0;
for (const { item, result, after, problems, record } of results) {
  const status = problems.length === 0 ? "PASS" : "FAIL";
  if (problems.length > 0) failed += 1;
  console.log(`[${status}] ${item.group}: ${item.name}`);
  console.log(`    argv: ${JSON.stringify(item.args)}`);
  console.log(`    exit: ${result.code} (expected ${item.exit})`);
  if (item.stderr !== undefined) console.log(`    expected stderr: ${JSON.stringify(item.stderr)}`);
  console.log(`    stderr: ${JSON.stringify(result.stderr.trimEnd())}`);
  console.log(`    stdout: ${JSON.stringify(result.stdout.trimEnd().slice(0, 300))}`);
  console.log(`    files after: ${JSON.stringify(after)}`);
  if (record !== undefined) console.log(`    record: ${JSON.stringify(record)}`);
  for (const problem of problems) console.log(`    problem: ${problem}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed of ${results.length} cases.`);
process.exitCode = failed === 0 ? 0 : 1;
