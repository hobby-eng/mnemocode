import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { questionsOnPrivateScreen, terminal } from "./helpers/question-terminal.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
/** How many links of a QR image to its name fail yet, as on a full disk. */
const faults = vi.hoisted(() => ({ qrFailures: 0 }));
vi.mock("node:tty", async (original) => harness.replacedTty(await original()));
vi.mock("../src/cli/terminal-input.js", async (original) =>
  harness.replacedTerminalInput(await original()),
);
// The files are the program's edge: the link that gives a finished QR image its name fails while
// a case asks it to. Every rendering, save and other link is the real one.
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return {
    ...real,
    link: async (existing: string, destination: string) => {
      if (destination.endsWith("-qr.png") && faults.qrFailures-- > 0)
        throw Object.assign(new Error("Synthetic save failure"), { code: "ENOSPC" });
      return real.link(existing, destination);
    },
  };
});

import { runEncode } from "../src/cli/encode-command.js";
import { optionLabel, evidenceLabel } from "../src/cli/option-copy.js";
import { FIRST_RECEIVING_LOCATION, type WalletEvidence } from "../src/core/wallet-evidence.js";
import { runTable } from "../src/cli/table-command.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { PrivateSteps } from "../src/cli/private-steps.js";
import { testFolder } from "./helpers/test-folders.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

/** The first bytes of every PDF file (ISO 32000-1, 7.5.2). */
const PDF_SIGNATURE = "%PDF-";

questionsOnPrivateScreen();
afterEach(() => {
  faults.qrFailures = 0;
  PrivateSteps.close();
});

it.each(["Try again", "Skip", CANCELLED] as const)(
  "keeps the saved primary file when an automatic QR fails (%s)",
  async (choice) => {
    const folder = await testFolder("mnemocode-aud026-cli-");
    terminal.answers = [`${TEST_PHRASE}\r`];
    terminal.choices = [choice];
    faults.qrFailures = 1;
    const result = await runEncode({
      "ask-secrets": true,
      mode: "direct",
      format: "5",
      pdf: join(folder, "sheet.pdf"),
      "card-qr": true,
    });
    const pdf = await readFile(join(folder, "sheet.pdf"));
    expect(pdf.subarray(0, PDF_SIGNATURE.length).toString("latin1")).toBe(PDF_SIGNATURE);
    expect(terminal.questions).toContain("What now?");
    expect(existsSync(join(folder, "sheet-qr.png"))).toBe(choice === "Try again");
    expect(result).toBe(choice === CANCELLED ? CANCELLED : undefined);
  },
);

it("keeps the labels of supported wallet evidence and redacts unknown keys", () => {
  const location = FIRST_RECEIVING_LOCATION;
  const evidences: readonly WalletEvidence[] = [
    { kind: "address", value: "public fixture", profiles: ["native-segwit"], location },
    { kind: "master-xpub", value: "public fixture", network: "mainnet" },
    { kind: "account-xpub", value: "public fixture", profiles: ["native-segwit"], location },
  ];
  for (const evidence of evidences) expect(evidenceLabel(evidence)).not.toBe("unknown option");
  for (const key of ["account", "branch", "index"])
    expect(optionLabel(key)).not.toBe("unknown option");
  for (const key of ["constructor", "__proto__", "private-looking input"])
    expect(optionLabel(key)).toBe("unknown option");
});

it("refuses conflicting table selectors before writing any rows", async () => {
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    for (const args of [
      { all: true, word: "abandon" },
      { all: true, index: "0" },
      { all: true, unicode: "7684" },
    ])
      await expect(runTable(args)).rejects.toThrow("Choose exactly one lookup value");
    expect(write).not.toHaveBeenCalled();
    await runTable({ all: true });
    expect(write).toHaveBeenCalledOnce();
  } finally {
    write.mockRestore();
  }
});

it("retains startup warnings and the current step warning until the private command ends", () => {
  const redraws: string[][] = [];
  PrivateSteps.open(
    () => redraws.push([]),
    (warning) => redraws.at(-1)?.push(warning),
  );
  PrivateSteps.remember("Public swap warning");
  PrivateSteps.remember("Public cloud warning");
  PrivateSteps.remember("Public cloud warning");
  PrivateSteps.begin();
  PrivateSteps.remember("Public synthetic warning");
  PrivateSteps.begin();
  PrivateSteps.remember("Public replacement warning");
  PrivateSteps.begin();
  PrivateSteps.answerAccepted();
  PrivateSteps.begin();
  expect(redraws).toEqual([
    ["Public swap warning", "Public cloud warning"],
    ["Public swap warning", "Public cloud warning", "Public synthetic warning"],
    ["Public swap warning", "Public cloud warning", "Public replacement warning"],
    ["Public swap warning", "Public cloud warning"],
  ]);
  PrivateSteps.close();
  PrivateSteps.begin();
  expect(redraws).toHaveLength(4);
});
