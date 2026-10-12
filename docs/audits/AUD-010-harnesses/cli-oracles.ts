// AUD-010 cli reviewer: command-line results and documented numbers against independent oracles.
//
//   node docs/audits/AUD-010-harnesses/run-command.mjs cli-oracles \
//       node --import tsx docs/audits/AUD-010-harnesses/cli-oracles.ts
//
// 1. recover-word through the production entry (src/mnemocode.ts, piped): the candidates of a
//    missing word and of a forgotten last word, compared with a brute force over the 2048 English
//    words checked by @scure/bip39 validateMnemonic directly; no duplicate row; README counts.
// 2. The README fixtures used by the other cli probes: the first Ethereum address and the BIP84
//    address of the test phrase, derived with @scure/bip32, @noble/curves and @noble/hashes keccak
//    (EIP-55 checksum written here), and its master fingerprint.
// 3. The README's "A search of every date has 3,652,059 attempts": the days from 0001-01-01 through
//    9999-12-31 counted with Date.UTC, against the count recover-date reports for the pattern ?.
// 4. Help pages and README against the code's constants: --scan-gap default 20 and maximum 1000,
//    --max-results 100, --progress-every 1000, 2,147,483,648 attempts at most.
// 5. Every README anchor that the command line links to (readmeLink, terminalMore and the repair
//    report) is a heading of README.md.
// Public data only. Exit 1 when a check fails.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bech32 } from "@scure/base";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const SOURCE = join(ROOT, "src/mnemocode.ts");
const TSX = pathToFileURL(join(ROOT, "node_modules/tsx/dist/loader.mjs")).href;
const PHRASE = `${Array(11).fill("abandon").join(" ")} about`;
const MASKED = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";

let failed = 0;
function check(label: string, ok: boolean, observed: unknown, expected?: unknown): void {
  if (!ok) failed += 1;
  const tail = expected === undefined ? "" : ` (expected ${JSON.stringify(expected)})`;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}: ${JSON.stringify(observed)}${tail}`);
}

function cli(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const env = { ...process.env, TERM: "xterm-256color" };
  delete env.NO_COLOR;
  delete env.CLICOLOR_FORCE;
  const result = spawnSync(process.execPath, ["--import", TSX, SOURCE, ...args], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The last column of each candidate row of recover-word's plain output. */
function candidateRows(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => /^\d+\t/u.test(line))
    .map((line) => line.split("\t").at(-1)!);
}

// 1. recover-word.
console.log("1. recover-word against a brute force with @scure/bip39");
{
  const written = Array(11).fill("abandon");
  const oracle = new Set<string>();
  for (let place = 0; place <= written.length; place += 1)
    for (const word of wordlist) {
      const phrase = [...written.slice(0, place), word, ...written.slice(place)].join(" ");
      if (validateMnemonic(phrase, wordlist)) oracle.add(phrase);
    }
  const run = cli(["recover-word", "--missing-word", "--mnemonic", written.join(" ")]);
  const rows = candidateRows(run.stdout);
  const unique = new Set(rows);
  check("missing word: exit code", run.code === 0, run.code, 0);
  check("missing word: rows", rows.length, rows.length, oracle.size);
  check("missing word: no duplicate rows", unique.size === rows.length, unique.size, rows.length);
  check(
    "missing word: same phrases as the oracle",
    unique.size === oracle.size && [...oracle].every((phrase) => unique.has(phrase)),
    [...oracle].filter((phrase) => !unique.has(phrase)).length,
    0,
  );
  check("README: about 1,500 candidates for 12 words", Math.abs(rows.length - 1500) < 100, rows.length);

  for (const words of [12, 24]) {
    const start = Array(words - 1).fill("abandon");
    const expected = wordlist.filter((word) => validateMnemonic([...start, word].join(" "), wordlist));
    const last = cli(["recover-word", "--mnemonic", `${start.join(" ")} ?`]);
    const found = candidateRows(last.stdout).map((phrase) => phrase.split(" ").at(-1)!);
    check(`${words} words, last word ?: candidates`, found.length, found.length, expected.length);
    check(
      `${words} words, last word ?: same words in list order`,
      JSON.stringify(found) === JSON.stringify(expected),
      found.slice(0, 4),
      expected.slice(0, 4),
    );
  }
}

// 2. Fixtures.
console.log("2. README fixtures derived independently");
{
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(PHRASE));
  check("master fingerprint", root.fingerprint.toString(16).padStart(8, "0") === "73c5da0a",
    root.fingerprint.toString(16).padStart(8, "0"), "73c5da0a");
  const eth = root.derive("m/44'/60'/0'/0/0");
  const uncompressed = secp256k1.Point.fromHex(bytesToHex(eth.publicKey!)).toBytes(false);
  const lower = bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20));
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  const checksummed =
    "0x" +
    [...lower].map((char, i) => (Number.parseInt(hash[i]!, 16) >= 8 ? char.toUpperCase() : char)).join("");
  check("Ethereum m/44'/60'/0'/0/0", checksummed === "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    checksummed, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  const segwit = root.derive("m/84'/0'/0'/0/0");
  const program = ripemd160(sha256(segwit.publicKey!));
  const address = bech32.encode("bc", [0, ...bech32.toWords(program)]);
  check("BIP84 m/84'/0'/0'/0/0", address === "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", address,
    "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
}

// 3. Every supported date.
console.log("3. The pattern ? against a count of calendar days");
{
  const first = Date.UTC(2000, 0, 1) - 0; // placeholder so that setUTCFullYear keeps years < 100
  const start = new Date(first);
  start.setUTCFullYear(1, 0, 1);
  const end = new Date(first);
  end.setUTCFullYear(10000, 0, 1);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  check("days from 0001-01-01 through 9999-12-31", days === 3_652_059, days, 3_652_059);
  const run = cli([
    "recover-date", "--mode", "seedshift-legacy", "--input", MASKED, "--format", "1",
    "--dates", "?", "--max-candidates", "1",
  ]);
  const reported = /produce ([\d,]+) combinations/u.exec(run.stderr)?.[1];
  check("recover-date reports the same count for ?", reported === days.toLocaleString("en-US"),
    run.stderr.trim(), days.toLocaleString("en-US"));
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  check("README states 3,652,059", readme.includes("A search of every date has 3,652,059 attempts"), true);
}

// 4. Defaults and limits.
console.log("4. Help pages and README against the constants of the code");
{
  const { DEFAULT_ADDRESS_COUNT, MAX_ADDRESS_COUNT } = await import("../../../src/core/address-scan.ts");
  const { MAX_SHOWN_MATCHES, HARD_MAX_COMBINATIONS } = await import("../../../src/core/date-search.ts");
  const { PROGRESS_EVERY } = await import("../../../src/cli/date-search.ts");
  const help: Record<string, string> = {};
  for (const command of ["decode", "recover-date", "recover-word", "sskr-combine", "sskr-export"])
    help[command] = cli([command, "--help"]).stdout.replace(/\s+/gu, " ");
  for (const [command, text] of Object.entries(help)) {
    check(`${command} --help: --scan-gap default ${DEFAULT_ADDRESS_COUNT}`,
      text.includes(`--scan-gap <N> Scan N addresses from --index on; default ${DEFAULT_ADDRESS_COUNT}.`), command);
    check(`${command} --help: --scan-gap up to ${MAX_ADDRESS_COUNT}`, text.includes(`Up to ${MAX_ADDRESS_COUNT};`), command);
  }
  check(`decode --help: --max-results default ${MAX_SHOWN_MATCHES}`,
    help.decode!.includes(`Most date matches shown; default ${MAX_SHOWN_MATCHES}.`), MAX_SHOWN_MATCHES);
  check(`recover-date --help: --max-results default ${MAX_SHOWN_MATCHES}`,
    help["recover-date"]!.includes(`default ${MAX_SHOWN_MATCHES}`), MAX_SHOWN_MATCHES);
  check(`recover-date --help: --progress-every default ${PROGRESS_EVERY}`,
    help["recover-date"]!.includes(`Report progress after every N attempts; default ${PROGRESS_EVERY}.`), PROGRESS_EVERY);
  check("recover-date --help: at most 2,147,483,648", help["recover-date"]!.includes(
    `Up to ${HARD_MAX_COMBINATIONS.toLocaleString("en-US")};`), HARD_MAX_COMBINATIONS);
  const readme = readFileSync(join(ROOT, "README.md"), "utf8").replace(/\s+/gu, " ");
  check("README: first 20 receiving addresses", readme.includes(`the first ${DEFAULT_ADDRESS_COUNT} receiving addresses`), DEFAULT_ADDRESS_COUNT);
  check("README: --scan-gap N, up to 1000", readme.includes(`--scan-gap N\`, up to ${MAX_ADDRESS_COUNT}`), MAX_ADDRESS_COUNT);
  check("README: --max-results 100 by default", readme.includes(`(${MAX_SHOWN_MATCHES} by default)`), MAX_SHOWN_MATCHES);
  check("README: 2,147,483,648 attempts", readme.includes(`No search has more than ${HARD_MAX_COMBINATIONS.toLocaleString("en-US")} attempts`), HARD_MAX_COMBINATIONS);
  check("README: menu Enter takes 20", readme.includes(`Enter takes ${DEFAULT_ADDRESS_COUNT}`), DEFAULT_ADDRESS_COUNT);
}

// 5. README anchors.
console.log("5. README anchors linked from the command line");
{
  const slug = (heading: string): string =>
    heading.trim().toLowerCase().replace(/[^\p{L}\p{N} -]/gu, "").replaceAll(" ", "-");
  const anchors = new Set(
    readFileSync(join(ROOT, "README.md"), "utf8")
      .split("\n")
      .filter((line) => /^#{1,6} /u.test(line))
      .map((line) => slug(line.replace(/^#+ /u, ""))),
  );
  const linked = new Set<string>();
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
    );
  for (const file of files(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:readmeLink|terminalMore)\("([^"]+)"\)|ANCHOR = "([^"]+)"/gu))
      linked.add(match[1] ?? match[2]!);
  }
  for (const anchor of [...linked].sort())
    check(`#${anchor} is a README heading`, anchors.has(anchor), anchor);
}

// 6. A forgotten year, each shift once.
console.log("6. recover-date 23-09-???? in seedshift-legacy against the README's construction");
{
  // README "How checksum-valid Seedshift works": every word index plus the year, month and day of
  // the date in turn, modulo 2048; the original Seedshift shifts the last word too and keeps no
  // checksum. Undone here word by word, written independently of src/core/masking.ts.
  const masked = MASKED.split(" ").map((word) => wordlist.indexOf(word));
  const expected = new Map<string, number>();
  for (let year = 1; year <= 9999; year += 1) {
    const shifts = [year, 9, 23];
    const phrase = masked
      .map((index, place) => wordlist[(((index - shifts[place % 3]!) % 2048) + 2048) % 2048]!)
      .join(" ");
    // Years 2048 apart shift alike: the earliest is the one the README says is shown.
    if (validateMnemonic(phrase, wordlist) && !expected.has(phrase)) expected.set(phrase, year);
  }
  const run = cli([
    "recover-date", "--mode", "seedshift-legacy", "--input", MASKED, "--format", "1",
    "--dates", "23-09-????", "--max-results", "100000",
  ]);
  const rows = run.stdout.trim().split("\n").map((line) => line.split("\t"));
  const phrases = rows.map((row) => row[1]!);
  check("exit code", run.code === 0, run.code, 0);
  check("rows", rows.length, rows.length, expected.size);
  check("no duplicate phrase", new Set(phrases).size === phrases.length, new Set(phrases).size, phrases.length);
  const wrong = rows.filter(([date, phrase]) => expected.get(phrase!) !== Number(date!.slice(6)));
  check("each phrase with its earliest year, as the oracle", wrong.length === 0, wrong.slice(0, 3), []);
}

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
