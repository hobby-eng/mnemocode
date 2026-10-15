import { spawn } from "node:child_process";
import { mkdtemp, chmod, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// These fake tools never invoke gh, GnuPG or a release action. A fake sends SIGINT while a
// prerequisite is checked, before the signing helper can create a download folder.
describe.skipIf(process.platform === "win32")("Release helper cancellation", () => {
  it.each(["gh", "gpg", "sha256sum"])(
    "stops after the interrupted %s prerequisite",
    async (tool) => {
      const folder = await mkdtemp(join(tmpdir(), "mnemocode-release-cancel-"));
      try {
        const trace = join(folder, "calls.txt");
        for (const name of ["gh", "gpg", "sha256sum"]) {
          const file = join(folder, name);
          await writeFile(
            file,
            `#!${process.execPath}
require("node:fs").appendFileSync(${JSON.stringify(trace)}, ${JSON.stringify(name)} + "\\n");
process.stdout.write(${JSON.stringify(name)} + "\\n");
if (${JSON.stringify(name === tool)}) {
  process.kill(process.ppid, "SIGINT");
  process.exitCode = 130;
}
`,
          );
          await chmod(file, 0o700);
        }
        const child = spawn(process.execPath, ["scripts/sign-release.mjs", "v0.0.0"], {
          env: { ...process.env, PATH: folder, NO_COLOR: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let error = "";
        child.stdout.setEncoding("utf8").on("data", (text: string) => {
          out += text;
        });
        child.stderr.setEncoding("utf8").on("data", (text: string) => {
          error += text;
        });
        const code = await new Promise<number | null>((resolve, reject) => {
          child.on("error", reject);
          child.on("close", resolve);
        });
        // Fake prerequisite stdout is captured by the helper, never printed as a result.
        expect(out).toBe("");
        expect(error).toBe("Cancelled.\n");
        expect(code).toBe(130);
        const steps = ["gh", "gpg", "sha256sum"];
        expect((await readFile(trace, "utf8")).trim().split("\n")).toEqual(
          steps.slice(0, steps.indexOf(tool) + 1),
        );
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
  );
});
