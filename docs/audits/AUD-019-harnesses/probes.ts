// AUD-019 probes through production entry points, with public data only. Opt in through
// probe.config.ts; a probe that fails shows a finding that is still open. Not part of the
// ordinary test collection.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { readLine } from "../../../src/cli/terminal-input.js";
import { WordList, type WordHints } from "../../../src/core/word-hints.js";

const execute = promisify(execFile);

/** The public phrase "abandon … about", typed key by key with a pause after each word. */
const PHRASE = `${"abandon ".repeat(11)}about`;

describe("AUD-019-SEC001: the text a word hint is given while a phrase is typed", () => {
  it("is the word being typed and a few before it, never the phrase typed so far", async () => {
    const seen: number[] = [];
    // The production hints, wrapped to record how many words of the answer reach them.
    const recording: WordHints = {
      hint: (line) => {
        seen.push(line.trim().split(/\s+/u).filter(Boolean).length);
        return WordList.BIP39.hint(line);
      },
      completion: (line) => WordList.BIP39.completion(line),
    };
    const bytes = [...Buffer.from(`${PHRASE}\r`)];
    let read = 0;
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const answer = await readLine(async () => bytes[read++], {
        echo: true,
        // A pause after every key, as a person types: the hint is drawn each time.
        moreWithin: async () => false,
        hints: recording,
      });
      expect(answer).toBe(PHRASE);
    } finally {
      vi.restoreAllMocks();
    }
    expect(seen.length).toBeGreaterThan(0);
    // At most the word being typed and three before it (the fix's HINT_CONTEXT_WORDS).
    expect(Math.max(...seen)).toBeLessThanOrEqual(4);
  });
});

describe("AUD-019 control: the Linux kernel's boundaries, through Node.js's own calls", () => {
  it.runIf(process.platform === "linux")(
    "refuse a file write from the thread pool, a program and a socket, without the permission model",
    async () => {
      // A plain node process, no permission model: only the kernel can refuse these.
      const script = `
        const ffi = await import("node:ffi");
        const { systemSandbox } = await import("./dist/cli/system-sandbox.js");
        const fs = await import("node:fs/promises");
        const { spawnSync } = await import("node:child_process");
        const dgram = await import("node:dgram");
        const sandbox = systemSandbox(ffi);
        sandbox.start();
        sandbox.restrict({ writes: false, runsPrograms: false });
        const result = { held: sandbox.held() };
        try { await fs.writeFile("/dev/null", "x"); result.write = "written"; }
        catch (error) { result.write = error.code; }
        result.program = spawnSync("/bin/true").error?.code ?? "started";
        result.socket = await new Promise((resolve) => {
          const socket = dgram.createSocket("udp4");
          socket.on("error", (error) => resolve(error.code));
          socket.bind(0, "127.0.0.1", () => { socket.close(); resolve("bound"); });
        });
        console.log(JSON.stringify(result));`;
      const { stdout } = await execute(process.execPath, [
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "-e",
        script,
      ]);
      const result = JSON.parse(stdout) as Record<string, unknown>;
      expect(result.program).toBe("EACCES");
      expect(result.socket).toBe("EACCES");
      // Landlock for every thread needs a newer kernel; where it holds, the pool's write fails.
      const held = String(result.held);
      if (held.includes("no file writes")) expect(result.write).toBe("EACCES");
      else expect(result.write).toBe("written");
    },
  );
});
