// AUD-015: strengthen AUD-014's staging assertions and trace the same contract through QR
// sidecars. Only the expensive rendering seams and a staging removal are substituted; file
// creation, publication and reading use the real filesystem. Public opaque fixture bytes only.
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import * as actualFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  failCleanup: false,
  leftovers: [] as string[],
  notices: [] as { text: string; kind: unknown }[],
}));
const DOCUMENT = "public document fixture";
const QR_IMAGE = "public QR image fixture";
vi.mock("../../../src/export/render.js", () => ({
  renderCards: async () => new TextEncoder().encode("public document fixture"),
}));
vi.mock("qrcode", () => ({
  default: {
    toBuffer: async () => {
      // The main document was already published; only the sidecar's cleanup will fail.
      state.failCleanup = true;
      return Buffer.from("public QR image fixture");
    },
  },
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (state.failCleanup && String(args[0]).includes(".mnemocode-export-")) {
        state.leftovers.push(String(args[0]));
        throw Object.assign(new Error("synthetic cleanup denied"), { code: "EACCES" });
      }
      return fs.rm(...args);
    },
  };
});
vi.mock("../../../src/cli/terminal.js", async (original) => ({
  ...(await original<typeof import("../../../src/cli/terminal.js")>()),
  terminalNotice: (text: string, kind: unknown) => state.notices.push({ text, kind }),
}));

import { runEncode } from "../../../src/cli/encode-command.js";
import { saveQrBeside, saveQrInside } from "../../../src/cli/qr-export.js";
import { saveWithRetry } from "../../../src/cli/save-retry.js";
import { LeftStagingCopy, publishNewPrivateFile } from "../../../src/export/private-file.js";

const folders: string[] = [];
async function scratch(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "mnemocode-aud015-"));
  folders.push(folder);
  return folder;
}
afterEach(async () => {
  state.failCleanup = false;
  state.leftovers = [];
  state.notices = [];
  for (const folder of folders.splice(0))
    await actualFs.rm(folder, { recursive: true, force: true });
});

it("retains a real private copy and identifies exactly which saved file and folder remain", async () => {
  const path = join(await scratch(), "public-output.bin");
  state.failCleanup = true;
  const failure = await publishNewPrivateFile(path, new TextEncoder().encode(DOCUMENT)).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(LeftStagingCopy);
  const leftover = failure as LeftStagingCopy;
  expect(leftover.saved).toBe(path);
  expect(state.leftovers).toEqual([leftover.staging]);
  expect(leftover.message).toContain(leftover.staging);
  expect(await readFile(path, "utf8")).toBe(DOCUMENT);
  expect(await readFile(join(leftover.staging, "document"), "utf8")).toBe(DOCUMENT);
});

it("returns the saved name once, warns about the real copy, and never offers a retry", async () => {
  const path = join(await scratch(), "public-output.bin");
  state.failCleanup = true;
  let writes = 0;
  const saved = await saveWithRetry({
    what: "The public fixture",
    kind: "file",
    path,
    write: async (destination) => {
      writes++;
      await publishNewPrivateFile(destination, new TextEncoder().encode(DOCUMENT));
    },
    checkName: async () => {
      throw new Error("unexpected retry");
    },
  });
  expect(saved).toBe(path);
  expect(writes).toBe(1);
  expect(state.notices).toHaveLength(1);
  expect(state.notices[0]!.kind).toBe("warning");
  expect(state.notices[0]!.text).toContain(state.leftovers[0]);
  expect(await readFile(path, "utf8")).toBe(DOCUMENT);
});

it.each(["beside", "inside"] as const)(
  "reports a published QR sidecar %s as saved, with the cleanup warning",
  async (where) => {
    const folder = await scratch();
    const path = join(folder, where === "beside" ? "sheet-qr.png" : "qr.png");
    let failure: unknown;
    try {
      if (where === "beside") await saveQrBeside("public fixture", join(folder, "sheet.pdf"));
      else await saveQrInside("public fixture", folder);
    } catch (error) {
      failure = error;
    }
    const published = (await readFile(path, "utf8")) === QR_IMAGE;
    console.log(
      JSON.stringify({
        probe: `qr-${where}`,
        published,
        exception: failure instanceof Error ? failure.name : null,
        warningCount: state.notices.length,
      }),
    );
    expect(published).toBe(true);
    expect(failure).toBeUndefined();
    expect(state.notices).toHaveLength(1);
    expect(state.notices[0]!.kind).toBe("warning");
  },
);

it("Encode completes after publishing its sheet and QR sidecar despite cleanup failure", async () => {
  const folder = await scratch();
  const path = join(folder, "sheet.pdf");
  let failure: unknown;
  try {
    await runEncode({
      mnemonic: `${"abandon ".repeat(11)}about`,
      mode: "direct",
      format: "colors",
      pdf: path,
      "card-qr": true,
    });
  } catch (error) {
    failure = error;
  }
  expect(await readFile(path, "utf8")).toBe(DOCUMENT);
  expect(await readFile(join(folder, "sheet-qr.png"), "utf8")).toBe(QR_IMAGE);
  expect((await readdir(folder)).some((name) => name.startsWith(".mnemocode-export-"))).toBe(true);
  console.log(
    JSON.stringify({
      probe: "encode-qr-cleanup",
      bothPublished: true,
      exception: failure instanceof Error ? failure.name : null,
      cleanupWarnings: state.notices.filter((notice) => notice.kind === "warning").length,
    }),
  );
  expect(failure).toBeUndefined();
  expect(
    state.notices.some(
      (notice) => notice.kind === "warning" && notice.text.includes(state.leftovers[0]!),
    ),
  ).toBe(true);
});
