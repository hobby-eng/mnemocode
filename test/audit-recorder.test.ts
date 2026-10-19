import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";

describe.skipIf(process.platform === "win32")("Historical recorder path metadata", () => {
  it.each([
    { moved: false, code: 0 },
    { moved: true, code: 0 },
    { moved: false, code: 7 },
    { moved: true, code: 7 },
  ])(
    "records cwd, arguments and failure after relocation=$moved, exit=$code",
    async ({ moved, code }) => {
      const root = resolve(".");
      const evidence = join(root, "docs/audits/AUD-030-evidence");
      await mkdir(evidence, { recursive: true });
      const folder = await mkdtemp(join(evidence, "r08-replay-"));
      try {
        const original = resolve("docs/audits/AUD-002-harnesses/lib.sh");
        const script = moved ? join(folder, "harnesses/lib.sh") : original;
        if (moved) {
          await mkdir(join(folder, "harnesses"));
          await writeFile(script, await readFile(original));
        }
        const recordFolder = join(folder, "records");
        const invocation = join(folder, "invocation");
        await mkdir(recordFolder);
        await mkdir(invocation);
        const child = spawnSync(
          "bash",
          [
            "-c",
            [
              'source "$1"',
              // Check the recorder with the caller's installed tools, not its historical local PATH.
              'export PATH="$6"',
              'E="$2"',
              'cd "$3"',
              'printf "%s\\n" "$ROOT"',
              'run harmless bash -c \'pwd; printf "%s\\n" "$1"; exit "$2"\' _ "$4" "$5"',
            ].join("\n"),
            "recorder-test",
            script,
            recordFolder,
            invocation,
            "two words with spaces",
            String(code),
            process.env.PATH ?? "",
          ],
          { encoding: "utf8" },
        );
        const record = JSON.parse(
          await readFile(join(recordFolder, "harmless.command.json"), "utf8"),
        ) as {
          cwd: string;
          exitCode: number;
        };
        expect(child.error).toBeUndefined();
        expect(child.status).toBe(code);
        expect(child.stdout.split("\n")[0]).toBe(root);
        expect((await readFile(join(recordFolder, "harmless.log"), "utf8")).trim()).toBe(
          invocation + "\ntwo words with spaces",
        );
        expect(record.cwd).toBe(invocation);
        expect(record.exitCode).toBe(code);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
  );
});
