import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Standard input and standard error are a terminal; a Keyboard stands for the one on standard
// input, which the program's own reader reads. What is typed while no question reads it stays in
// the Keyboard, as in a terminal's own buffer, and arrives once a question reads again. Each
// question is answered once it shows on standard error, as a person answers what the screen shows:
// a typed question by its prompt, a list question by its entries as drawn (drawn-list.ts).
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => true,
}));

import { COINS } from "../src/core/coins.js";
import { BITCOIN_PROFILES, type BitcoinEvidence } from "../src/bitcoin-evidence.js";
import { askAfterFailure, askSecretUntil, askValueUntil, droppedPath } from "../src/cli/ask.js";
import { askWalletEvidence } from "../src/cli/wallet-question.js";
import { assertWalletPlaceUsed, walletPlaceOf } from "../src/cli/bitcoin-options.js";
import { LAST_NORMAL_INDEX } from "../src/core/bip32-limits.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { recordDrawnCuts, takeCutNotes } from "./helpers/cut-notes.js";
import { drawnList, keysOfAnswer, type DrawnList, type ListAnswer } from "./helpers/drawn-list.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";
import { Keyboard, keyboardAsStandardInput } from "./helpers/terminal-streams.js";

/** The public test phrase's first native SegWit receiving address, m/84'/0'/0'/0/0. */
const FIRST_ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
/** A valid testnet address (BIP173's example), which mainnet refuses by name. */
const TESTNET_ADDRESS = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
const CTRL_C = "\x03";
const CTRL_D = "\x04";
const ESCAPE = "\x1b";
/** The list questions of the wallet, as askWalletEvidence asks them. */
const WALLET_QUESTION = "How can MnemoCode recognise the wallet?";
const COIN_QUESTION = "Which coin is the address for?";

/** A question to answer once it shows: a typed one by its prompt, a list one by its question. */
type AwaitedQuestion =
  | { readonly kind: "line"; readonly prompt: string; readonly keys: string | Buffer }
  | { readonly kind: "list"; readonly question: string; readonly answer: ListAnswer };

let keyboard = new Keyboard();
/** Everything written to standard error. */
let screen = "";
/** Where the question last answered ends in `screen`: a later one is looked for after it. */
let seen = 0;
/** The questions to answer, in the order they are asked. */
let awaited: AwaitedQuestion[] = [];
/** The list questions asked, as they showed. */
let asked: DrawnList[] = [];
/** The warnings and other lines of console.error. */
let notices: string[] = [];

/** Types `typed` once `prompt` is drawn, after the answers given before it. */
function at(prompt: string, typed: string | Buffer): void {
  awaited.push({ kind: "line", prompt, keys: typed });
}

/**
 * Picks the entry labelled `answer` once the list question `question` is drawn, after the answers
 * given before it, with the keys a person would press; undefined presses Escape.
 */
function pick(question: string, answer: ListAnswer): void {
  awaited.push({ kind: "list", question, answer });
}

/**
 * The keys that answer the next awaited question, once `screen` shows it after `seen`: a typed
 * question's once its prompt is drawn, a list question's once its key hint is, the list recorded
 * in `asked` and its notes cut to fit in cut-notes.ts. None while it does not show yet.
 */
function keysOfShownQuestion(): string | Buffer | undefined {
  const next = awaited[0];
  if (next === undefined) return undefined;
  if (next.kind === "line") {
    const found = screen.indexOf(`${next.prompt} `, seen);
    if (found < 0) return undefined;
    seen = found + next.prompt.length + 1;
    awaited.shift();
    return next.keys;
  }
  const found = screen.indexOf(`\n${next.question}\n`, seen);
  const list = found < 0 ? undefined : drawnList(screen.slice(found));
  if (list === undefined) return undefined;
  seen = screen.length;
  awaited.shift();
  asked.push(list);
  recordDrawnCuts(list);
  return keysOfAnswer(list, next.answer);
}

beforeEach(() => {
  keyboard = new Keyboard();
  screen = "";
  seen = 0;
  awaited = [];
  asked = [];
  notices = [];
  keyboardAsStandardInput(keyboard);
  vi.stubEnv("NO_COLOR", "1");
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    screen += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const keys = keysOfShownQuestion();
    // Typed once the question shows, as a person would.
    if (keys !== undefined) setImmediate(() => keyboard.type(keys));
    return true;
  });
  vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
    notices.push(line.join(" "));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  expect(awaited, "a question that was not asked").toEqual([]);
  expect(takeCutNotes(), "a note cut to fit its list").toEqual([]);
});

describe("questions asked again until the answer can be used", () => {
  it("asks again after an empty answer and after Ctrl+D, with one line", async () => {
    at("Dates:", "   \r");
    at("Dates:", CTRL_D);
    at("Dates:", "23-09-2026\r");
    expect(await askSecretUntil("Dates:", (answer) => answer, { what: "the dates" })).toBe(
      "23-09-2026",
    );
    expect(notices).toEqual([
      "Type the dates, or press Ctrl+C to stop.",
      "Type the dates, or press Ctrl+C to stop.",
    ]);
  });

  it("shows an error of the check as one warning and asks again, never with the answer", async () => {
    at("Phrase:", "abandon abandom\r");
    at("Phrase:", "abandon about\r");
    const parse = (answer: string): string[] => {
      if (answer.includes("abandom")) throw new Error("Unknown English BIP39 word at place 2.");
      return answer.split(" ");
    };
    expect(await askSecretUntil("Phrase:", parse)).toEqual(["abandon", "about"]);
    expect(notices).toEqual(["Unknown English BIP39 word at place 2."]);
    // Not on the private screen nothing typed shows.
    expect(screen).not.toContain("abandom");
    expect(screen.match(/Phrase: /gu)).toHaveLength(2);
  });

  it("gives CANCELLED at Ctrl+C, and lets through anything thrown that is not an Error", async () => {
    at("Phrase:", `abc${CTRL_C}`);
    expect(await askSecretUntil("Phrase:", (answer) => answer)).toBe(CANCELLED);
    at("Phrase:", "abc\r");
    await expect(
      askSecretUntil("Phrase:", () => {
        throw "not an error";
      }),
    ).rejects.toBe("not an error");
  });

  it("drops what was typed before the question showed, and cancels at a Ctrl+C among it", async () => {
    // A second Enter and the rest of a paste, typed while nothing read the terminal.
    keyboard.type("\rleft over\r");
    at("Dates:", "23-09-2026\r");
    expect(await askSecretUntil("Dates:", (answer) => answer)).toBe("23-09-2026");
    expect(notices).toEqual([]);
    keyboard.type(`typed ahead${CTRL_C}`);
    expect(await askSecretUntil("Dates:", (answer) => answer)).toBe(CANCELLED);
  });

  it("takes a paste of several lines as one answer, with ; between shares where asked", async () => {
    at("Phrase:", "abandon\r\nabandon\n\nabout\r");
    expect(await askSecretUntil("Phrase:", (answer) => answer)).toBe("abandon abandon about");
    at("Shares:", "tuna acid;\nyurt able\r");
    at("Shares:", "tuna acid\nyurt able\r");
    expect(await askSecretUntil("Shares:", (a) => a, { pastedLineBreak: ";" })).toBe(
      "tuna acid;yurt able",
    );
    expect(await askSecretUntil("Shares:", (a) => a, { pastedLineBreak: ";" })).toBe(
      "tuna acid;yurt able",
    );
  });
});

describe("questions asked again until the answer can be used", () => {
  it("asks again after a paste longer than any answer, whose rest answers nothing", async () => {
    at("Phrase:", Buffer.alloc(1024 * 1024 + 4096, 0x61));
    at("Phrase:", "abandon\r");
    expect(await askSecretUntil("Phrase:", (answer) => answer)).toBe("abandon");
    expect(notices).toEqual([
      "An answer is longer than 1048576 bytes; no valid answer is that long.",
    ]);
  });

  it("asks again after an answer that is not UTF-8", async () => {
    at("Phrase:", Buffer.from([0xff, 0x0d]));
    at("Phrase:", "abandon\r");
    expect(await askSecretUntil("Phrase:", (answer) => answer)).toBe("abandon");
    expect(notices).toEqual(["The answer is not valid UTF-8 text."]);
  });

  it("asks a secret again after an empty answer and trims the answer", async () => {
    at("Seed phrase:", "\r");
    at("Seed phrase:", `  ${TEST_PHRASE}  \r`);
    expect(await askSecretUntil("Seed phrase:", (answer) => answer)).toBe(TEST_PHRASE);
    expect(notices).toEqual(["Type an answer, or press Ctrl+C to stop."]);
  });

  it("asks for a visible value until it can be used; Escape goes back", async () => {
    at("Fingerprint:", "\r");
    at("Fingerprint:", "73c5da0a\r");
    expect(await askValueUntil("Fingerprint:", (answer) => answer, { what: "it" })).toBe(
      "73c5da0a",
    );
    expect(notices).toEqual(["Type it, or press Esc to go back."]);
    // The value shows as it is typed, also off the private screen.
    expect(screen).toContain("73c5da0a");
    at("Fingerprint:", ESCAPE);
    expect(await askValueUntil("Fingerprint:", (answer) => answer)).toBeUndefined();
  });

  it("asks what to do after a failure; Escape picks the last choice", async () => {
    const choices = [
      { label: "Change the dates", value: "dates" },
      { label: "Stop", value: "stop" },
    ];
    pick("What now?", "Change the dates");
    expect(await askAfterFailure("What now?", choices)).toBe("dates");
    pick("What now?", undefined);
    expect(await askAfterFailure("What now?", choices, { escape: "stops here" })).toBe("stop");
    // What Escape does, as each key hint says.
    expect(asked.map(({ question, escape }) => ({ question, escape }))).toEqual([
      { question: "What now?", escape: "stops" },
      { question: "What now?", escape: "stops here" },
    ]);
  });
});

describe("questions asked again until the answer can be used", () => {
  it("asks for the wallet and checks each value at once, as bitcoin-evidence.ts does", async () => {
    pick(WALLET_QUESTION, "Fingerprint");
    at(
      "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one; They do not reveal the phrase.):",
      "zz\r",
    );
    at(
      "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one; They do not reveal the phrase.):",
      "73C5DA0A\r",
    );
    expect(await askWalletEvidence({ optional: false })).toEqual({
      kind: "wallet",
      evidence: { kind: "master-fingerprint", value: "73c5da0a", network: "mainnet" },
    });
    expect(notices).toEqual(["A master fingerprint must be eight hexadecimal characters."]);
    notices = [];
    pick(WALLET_QUESTION, "Address");
    pick(COIN_QUESTION, "Bitcoin");
    at("Bitcoin address (one of the first receiving ones):", `${TESTNET_ADDRESS}\r`);
    at("Bitcoin address (one of the first receiving ones):", `${FIRST_ADDRESS}\r`);
    // How many of the first addresses it is compared with: Enter takes the first 20.
    at("Compare with how many addresses from the first (Enter: 20):", "\r");
    const answer = await askWalletEvidence({ optional: false });
    expect(answer).toMatchObject({
      kind: "wallet",
      evidence: {
        kind: "address",
        value: FIRST_ADDRESS,
        location: { network: "mainnet", account: 0, branch: 0, index: 0 },
        addresses: 20,
      },
    });
    expect(notices).toEqual([
      "The address is not valid for Bitcoin mainnet; it is a testnet address.",
    ]);
    notices = [];
    pick(WALLET_QUESTION, "Address");
    pick(COIN_QUESTION, "Bitcoin");
    at("Bitcoin address (one of the first receiving ones):", `${FIRST_ADDRESS}\r`);
    at("Compare with how many addresses from the first (Enter: 20):", "0\r");
    at("Compare with how many addresses from the first (Enter: 20):", "1001\r");
    at("Compare with how many addresses from the first (Enter: 20):", "50\r");
    expect(await askWalletEvidence({ optional: false })).toMatchObject({
      evidence: { kind: "address", addresses: 50 },
    });
    expect(notices).toEqual([
      "Type a number from 1 through 1000.",
      "Type a number from 1 through 1000.",
    ]);
    notices = [];
    // --scan-gap answers the count, which is then not asked.
    pick(WALLET_QUESTION, "Address");
    pick(COIN_QUESTION, "Bitcoin");
    at("Bitcoin address (one of the first 5 receiving ones):", `${FIRST_ADDRESS}\r`);
    expect(
      await askWalletEvidence({
        optional: false,
        place: walletPlaceOf(undefined, { "scan-gap": "5", "ask-secrets": true }),
      }),
    ).toMatchObject({ evidence: { kind: "address", addresses: 5 } });
    // Escape at the value goes back to the list; Escape there goes back from the question.
    pick(WALLET_QUESTION, "Fingerprint");
    at(
      "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one; They do not reveal the phrase.):",
      ESCAPE,
    );
    pick(WALLET_QUESTION, undefined);
    expect(await askWalletEvidence({ optional: true })).toEqual({ kind: "back" });
    pick(WALLET_QUESTION, "It cannot");
    expect(await askWalletEvidence({ optional: true })).toEqual({ kind: "none" });
  });

  it("offers a count that fits at the last index of a branch (AUD-012-UI001)", async () => {
    const location = {
      network: "mainnet" as const,
      account: 0,
      branch: 0,
      index: LAST_NORMAL_INDEX,
    };
    pick(WALLET_QUESTION, "Address");
    pick(COIN_QUESTION, "Bitcoin");
    at(
      `Bitcoin address (one of the addresses from m/.../0'/0/${LAST_NORMAL_INDEX}):`,
      `${FIRST_ADDRESS}\r`,
    );
    at(`Compare with how many addresses from m/.../0'/0/${LAST_NORMAL_INDEX} (Enter: 1):`, "\r");
    expect(
      await askWalletEvidence({ optional: false, place: { location, profiles: BITCOIN_PROFILES } }),
    ).toMatchObject({ evidence: { kind: "address", location, addresses: 1 } });
    expect(notices).toEqual([]);
  });
});

describe("questions asked again until the answer can be used", () => {
  it("looks for another wallet where the one given was, and refuses such options without it", async () => {
    const given: BitcoinEvidence = {
      kind: "address",
      value: TESTNET_ADDRESS,
      profiles: ["native-segwit"],
      location: { network: "testnet", account: 1, branch: 0, index: 5 },
      addresses: 1,
    };
    pick(WALLET_QUESTION, "Address");
    pick(COIN_QUESTION, "Bitcoin");
    at("Bitcoin address (m/.../1'/0/5):", `${TESTNET_ADDRESS}\r`);
    expect(await askWalletEvidence({ optional: false, place: walletPlaceOf(given, {}) })).toEqual({
      kind: "wallet",
      evidence: given,
    });
    expect(asked[0]!.entries).toContainEqual(
      expect.objectContaining({ label: "Address", note: "its address at m/.../1'/0/5" }),
    );
    // Every coin in one list, as mhfe asks it; Bitcoin with the forms of the place's network.
    expect(asked[1]!.question).toBe(COIN_QUESTION);
    expect(asked[1]!.entries).toContainEqual(
      expect.objectContaining({ label: "Bitcoin", note: "m…, n…, 2…, tb1q… or tb1p…" }),
    );
    expect(asked[1]!.entries.map(({ label }) => label)).toEqual(COINS.map(({ name }) => name));
    // A fingerprint keeps the network; an address after it is the first receiving one there.
    const fingerprint: BitcoinEvidence = {
      kind: "master-fingerprint",
      value: "00000000",
      network: "testnet",
    };
    expect(walletPlaceOf(fingerprint, {})).toEqual({
      location: { network: "testnet", account: 0, branch: 0, index: 0 },
      profiles: BITCOIN_PROFILES,
    });
    pick(WALLET_QUESTION, "Fingerprint");
    at(
      "Original fingerprint of the wallet, such as 73c5da0a (not the encoded one; They do not reveal the phrase.):",
      "73c5da0a\r",
    );
    expect(
      await askWalletEvidence({ optional: false, place: walletPlaceOf(fingerprint, {}) }),
    ).toEqual({ kind: "wallet", evidence: { ...fingerprint, value: "73c5da0a" } });
    expect(walletPlaceOf(undefined, {})).toEqual({
      location: { network: "mainnet", account: 0, branch: 0, index: 0 },
      profiles: BITCOIN_PROFILES,
    });

    // Without a wallet given, the question would look for one elsewhere than these options say.
    expect(() => assertWalletPlaceUsed({ account: "1" }, undefined)).toThrow(
      "--account applies to a wallet given as an option",
    );
    expect(() => assertWalletPlaceUsed({ network: "testnet" }, fingerprint)).not.toThrow();
    expect(() => assertWalletPlaceUsed({ "ask-secrets": true }, undefined)).not.toThrow();
    // --scan-gap alone applies to a wallet asked on the screen, and to nothing without one.
    expect(walletPlaceOf(undefined, { "scan-gap": "30", "ask-secrets": true }).addresses).toBe(30);
    expect(() => walletPlaceOf(undefined, { "scan-gap": "30" })).toThrow(
      "--scan-gap applies to an address given with an option",
    );
  });

  it("reads a file name as a terminal gives a dragged file", () => {
    expect(droppedPath("'/home/user/My records/record.txt' ", "linux")).toBe(
      "/home/user/My records/record.txt",
    );
    expect(droppedPath("/Users/user/My\\ records/record\\ (1).txt", "darwin")).toBe(
      "/Users/user/My records/record (1).txt",
    );
    expect(droppedPath('"C:\\Users\\user\\My records\\record.txt"', "win32")).toBe(
      "C:\\Users\\user\\My records\\record.txt",
    );
    expect(droppedPath("C:\\Users\\user\\record.txt", "win32")).toBe("C:\\Users\\user\\record.txt");
    expect(droppedPath("~/record.txt", "linux")).toBe(join(homedir(), "record.txt"));
    expect(droppedPath("record.txt", "linux")).toBe("record.txt");
  });
});

describe("questions asked again until the answer can be used", () => {
  // Last: the end of the input stays for every later question of this file.
  it("ends as a cancel when the input ends, without asking again and again", async () => {
    const question = askSecretUntil("Phrase:", (answer) => answer);
    setTimeout(() => keyboard.emit("end"), 30);
    expect(await question).toBe(CANCELLED);
    expect(screen.match(/Phrase: /gu)).toHaveLength(1);
    // The end stays: a later question cancels at once.
    expect(await askSecretUntil("Again:", (answer) => answer)).toBe(CANCELLED);
  });
});
