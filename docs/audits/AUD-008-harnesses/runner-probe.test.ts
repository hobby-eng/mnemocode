import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);

it("records whether the Vitest worker captures an ordinary Node child", async () => {
  console.log(
    JSON.stringify({ execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS ?? null }),
  );
  for (const args of [
    ["-e", "console.log('PUBLIC-CAPTURE-PROBE')"],
    ["dist/mnemocode.js", "--version"],
  ]) {
    const result = await execute(process.execPath, args, { timeout: 15000 });
    console.log(JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr }));
    expect(result.stdout).not.toBe("");
  }
});
