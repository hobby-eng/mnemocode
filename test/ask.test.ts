import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Standard input and standard error are a terminal; a Keyboard stands for the one on standard
// input. What is typed while no question reads it stays in the Keyboard, as in a terminal's own
// buffer, and arrives once a question reads again. A list question (choose) is answered from
// `terminal.choices`, and Escape when none is left.
const terminal = vi.hoisted(() => ({
  privateScreen: false,
  choices: [] as unknown[],
  questions: [] as { question: string; quit: string | undefined }[],
  /** The entries of each list question, in order. */
  lists: [] as unknown[],
}));
vi.mock("node:tty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:tty")>()),
  isatty: () => true,
}));
vi.mock("../src/cli/private-screen.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/private-screen.js")>()),
  onPrivateScreen: () => terminal.privateScreen,
}));
vi.mock("../src/cli/terminal-choice.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cli/terminal-choice.js")>()),
  choose: async (question: string, choices: unknown, options: { quit?: string }) => {
    recordCutNotes(question, choices as never);
    terminal.questions.push({ question, quit: options.quit });
    terminal.lists.push(choices);
    return terminal.choices.shift();
  },
}));

import { bitcoinProfiles, type BitcoinEvidence } from "../src/bitcoin-evidence.js";
import {
  askAfterFailure,
  askSecretUntil,
  askValueUntil,
  askWalletEvidence,
  assertWalletPlaceUsed,
  droppedPath,
  walletPlaceOf,
} from "../src/cli/ask.js";
import { askSecret } from "../src/cli/input.js";
import { InputCancelled } from "../src/cli/terminal-input.js";
import { recordCutNotes, takeCutNotes } from "./helpers/cut-notes.js";

const TEST_PHRASE = `${"abandon ".repeat(11)}about`;
/** The public test phrase's first native SegWit receiving address, m/84'/0'/0'/0/0. */
const FIRST_ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
/** A valid testnet address (BIP173's example), which mainnet refuses by name. */
const TESTNET_ADDRESS = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
const CTRL_C = "\x03";
const CTRL_D = "\x04";
const ESCAPE = "\x1b";

/** Standard input as a terminal in raw mode. */
class Keyboard extends EventEmitter {
  readonly isTTY = true;
  flowing = false;
  /** Bytes typed while nothing reads: the terminal keeps them until a question reads again. */
  private held: Buffer[] = [];

  setRawMode(): this {
    return this;
  }

  resume(): this {
    this.flowing = true;
    // A terminal gives what it kept at the next read, a moment after reading starts.
    setImmediate(() => {
      for (const chunk of this.held.splice(0)) this.emit("data", chunk);
    });
    return this;
  }

  pause(): this {
    this.flowing = false;
    return this;
  }

  /** `keys` typed now, as one chunk. */
  type(keys: string | Buffer): void {
    const chunk = typeof keys === "string" ? Buffer.from(keys, "utf8") : keys;
    if (this.flowing) this.emit("data", chunk);
    else this.held.push(chunk);
  }
}

let keys = new Keyboard();
/** Everything written to standard error, and the answers to type at each prompt. */
let screen = "";
/** Where the prompt last answered ends in `screen`: a later one is looked for after it. */
let seen = 0;
let prompts: { readonly prompt: string; readonly keys: string | Buffer }[] = [];
/** The warnings and other lines of console.error. */
let notices: string[] = [];

/** Types `typed` once `prompt` is drawn, after the answers given before it. */
function at(prompt: string, typed: string | Buffer): void {
  prompts.push({ prompt, keys: typed });
}

describe("questions asked again until the answer can be used", () => {
  beforeEach(() => {
    keys = new Keyboard();
    screen = "";
    seen = 0;
    prompts = [];
    notices = [];
    terminal.privateScreen = false;
    terminal.choices = [];
    terminal.questions = [];
    terminal.lists = [];
    vi.spyOn(process, "stdin", "get").mockReturnValue(keys as unknown as typeof process.stdin);
    vi.stubEnv("TERM", "xterm");
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      screen += Buffer.from(chunk as Uint8Array).toString("utf8");
      const next = prompts[0];
      const found = next === undefined ? -1 : screen.indexOf(`${next.prompt} `, seen);
      if (next !== undefined && found >= 0) {
        seen = found + next.prompt.length + 1;
        prompts.shift();
        // Typed once the prompt shows, as a person would.
        setImmediate(() => keys.type(next.keys));
      }
      return true;
    });
    vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => {
      notices.push(line.join(" "));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    expect(takeCutNotes(), "a note cut to fit its list").toEqual([]);
  });

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

  it("lets Ctrl+C through, typed or thrown by the check, and anything not an Error", async () => {
    at("Phrase:", `abc${CTRL_C}`);
    await expect(askSecretUntil("Phrase:", (answer) => answer)).rejects.toBeInstanceOf(
      InputCancelled,
    );
    at("Phrase:", "abc\r");
    await expect(
      askSecretUntil("Phrase:", () => {
        throw new InputCancelled();
      }),
    ).rejects.toBeInstanceOf(InputCancelled);
    at("Phrase:", "abc\r");
    await expect(
      askSecretUntil("Phrase:", () => {
        throw "not an error";
      }),
    ).rejects.toBe("not an error");
  });

  it("drops what was typed before the question showed, and cancels at a Ctrl+C among it", async () => {
    // A second Enter and the rest of a paste, typed while nothing read the terminal.
    keys.type("\rleft over\r");
    at("Dates:", "23-09-2026\r");
    expect(await askSecretUntil("Dates:", (answer) => answer)).toBe("23-09-2026");
    expect(notices).toEqual([]);
    keys.type(`typed ahead${CTRL_C}`);
    await expect(askSecretUntil("Dates:", (answer) => answer)).rejects.toBeInstanceOf(
      InputCancelled,
    );
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

  it("keeps askSecret as it was called, on the same reader", async () => {
    at("Seed phrase:", "\r");
    at("Seed phrase:", `  ${TEST_PHRASE}  \r`);
    expect(await askSecret("Seed phrase:")).toBe(TEST_PHRASE);
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
    terminal.choices = ["dates"];
    expect(await askAfterFailure("What now?", choices)).toBe("dates");
    expect(await askAfterFailure("What now?", choices, { escape: "stops here" })).toBe("stop");
    expect(terminal.questions).toEqual([
      { question: "What now?", quit: "stops" },
      { question: "What now?", quit: "stops here" },
    ]);
  });

  it("asks for the wallet and checks each value at once, as bitcoin-evidence.ts does", async () => {
    terminal.choices = ["fingerprint"];
    at("Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):", "zz\r");
    at("Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):", "73C5DA0A\r");
    expect(await askWalletEvidence({ optional: false })).toEqual({
      kind: "wallet",
      evidence: { kind: "master-fingerprint", value: "73c5da0a", network: "mainnet" },
    });
    expect(notices).toEqual(["A master fingerprint must be eight hexadecimal characters."]);
    notices = [];
    terminal.choices = ["address"];
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
    terminal.choices = ["address"];
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
    terminal.choices = ["address"];
    at("Bitcoin address (one of the first 5 receiving ones):", `${FIRST_ADDRESS}\r`);
    expect(
      await askWalletEvidence({
        optional: false,
        place: walletPlaceOf(undefined, { "scan-gap": "5", "ask-secrets": true }),
      }),
    ).toMatchObject({ evidence: { kind: "address", addresses: 5 } });
    // Escape at the value goes back to the list; Escape there goes back from the question.
    terminal.choices = ["fingerprint"];
    at("Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):", ESCAPE);
    expect(await askWalletEvidence({ optional: true })).toEqual({ kind: "back" });
    terminal.choices = ["none"];
    expect(await askWalletEvidence({ optional: true })).toEqual({ kind: "none" });
  });

  it("looks for another wallet where the one given was, and refuses such options without it", async () => {
    const given: BitcoinEvidence = {
      kind: "address",
      value: TESTNET_ADDRESS,
      profiles: ["native-segwit"],
      location: { network: "testnet", account: 1, branch: 0, index: 5 },
      addresses: 1,
    };
    terminal.choices = ["address"];
    at("Bitcoin address (m/.../1'/0/5):", `${TESTNET_ADDRESS}\r`);
    expect(await askWalletEvidence({ optional: false, place: walletPlaceOf(given, {}) })).toEqual({
      kind: "wallet",
      evidence: given,
    });
    expect(terminal.lists[0]).toContainEqual(
      expect.objectContaining({
        note: "its address at m/.../1'/0/5",
        example: "m..., n..., 2..., tb1q... or tb1p...",
      }),
    );
    // A fingerprint keeps the network; an address after it is the first receiving one there.
    const fingerprint: BitcoinEvidence = {
      kind: "master-fingerprint",
      value: "00000000",
      network: "testnet",
    };
    expect(walletPlaceOf(fingerprint, {})).toEqual({
      location: { network: "testnet", account: 0, branch: 0, index: 0 },
      profiles: bitcoinProfiles,
    });
    terminal.choices = ["fingerprint"];
    at("Original fingerprint of the wallet, such as 73c5da0a (not the encoded one):", "73c5da0a\r");
    expect(
      await askWalletEvidence({ optional: false, place: walletPlaceOf(fingerprint, {}) }),
    ).toEqual({ kind: "wallet", evidence: { ...fingerprint, value: "73c5da0a" } });
    expect(walletPlaceOf(undefined, {})).toEqual({
      location: { network: "mainnet", account: 0, branch: 0, index: 0 },
      profiles: bitcoinProfiles,
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
  // Last: the end of the input stays for every later question of this file.
  it("ends as a cancel when the input ends, without asking again and again", async () => {
    const asked = askSecretUntil("Phrase:", (answer) => answer);
    setTimeout(() => keys.emit("end"), 30);
    await expect(asked).rejects.toBeInstanceOf(InputCancelled);
    expect(screen.match(/Phrase: /gu)).toHaveLength(1);
    // The end stays: a later question cancels at once.
    await expect(askSecretUntil("Again:", (answer) => answer)).rejects.toBeInstanceOf(
      InputCancelled,
    );
  });
});
