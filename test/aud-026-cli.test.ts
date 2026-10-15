import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { questionsOnPrivateScreen, terminal } from "./helpers/question-terminal.js";

const harness = await vi.hoisted(async () => import("./helpers/question-terminal.js"));
const faults = vi.hoisted(() => ({ qrFailures: 0 }));
vi.mock("node:tty", async (original) => harness.replacedTty(await original()));
vi.mock("../src/cli/private-screen.js", async (original) =>
  harness.replacedPrivateScreen(await original()),
);
vi.mock("../src/cli/terminal-input.js", async (original) =>
  harness.replacedTerminalInput(await original()),
);
vi.mock("../src/cli/terminal-choice.js", async (original) =>
  harness.replacedTerminalChoice(await original()),
);
vi.mock("../src/export/qr-image.js", async (original) => ({
  ...(await original<typeof import("../src/export/qr-image.js")>()),
  exportQrPayload: async () => {
    if (faults.qrFailures-- > 0)
      throw Object.assign(Error("Synthetic save failure"), { code: "ENOSPC" });
  },
}));
vi.mock("../src/cli/encode-export.js", async (original) => {
  const actual = await original<typeof import("../src/cli/encode-export.js")>();
  return {
    ...actual,
    saveEncodeResult: async (...args: Parameters<typeof actual.saveEncodeResult>) => {
      if (typeof args[0].pdf === "string") {
        const { publishNewPrivateFile } = await import("../src/export/private-file.js");
        await publishNewPrivateFile(args[0].pdf, Uint8Array.of(1, 2, 3));
      } else await actual.saveEncodeResult(...args);
    },
  };
});

import { runEncode } from "../src/cli/encode-command.js";
import { optionLabel, evidenceLabel } from "../src/cli/option-copy.js";
import { runTable } from "../src/cli/table-command.js";
import { CANCELLED } from "../src/cli/terminal-keys.js";
import { PrivateSteps } from "../src/cli/private-steps.js";

questionsOnPrivateScreen();
const folders: string[] = [];
afterEach(async () => {
  faults.qrFailures = 0;
  PrivateSteps.close();
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true });
});

it.each(["again", "skip", CANCELLED])(
  "keeps the saved primary file when an automatic QR fails (%s)",
  async (choice) => {
    const folder = await mkdtemp(join(tmpdir(), "mnemocode-aud026-cli-"));
    folders.push(folder);
    terminal.answers = ["abandon ".repeat(11) + "about\r"];
    terminal.choices = [choice];
    faults.qrFailures = 1;
    const result = await runEncode({
      "ask-secrets": true,
      mode: "direct",
      format: "5",
      pdf: join(folder, "sheet.pdf"),
      "card-qr": true,
    });
    expect((await stat(join(folder, "sheet.pdf"))).size).toBe(3);
    expect(terminal.questions).toContain("What now?");
    expect(result).toBe(choice === CANCELLED ? CANCELLED : undefined);
  },
);

it("keeps the labels of supported wallet evidence and redacts unknown keys", () => {
  for (const kind of ["address", "master-xpub", "account-xpub"] as const)
    expect(evidenceLabel({ kind } as never)).not.toBe("unknown option");
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
  const redraws: unknown[] = [];
  PrivateSteps.open((warning) => redraws.push(warning));
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
