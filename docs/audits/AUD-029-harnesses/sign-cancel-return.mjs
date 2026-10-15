// Exercise the actual command runner with inert children, never release main or real tools.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const ts = createRequire(import.meta.url)(resolve(root, "../tmp/cancel-check/node_modules/typescript"));
const text = readFileSync(resolve(root, "scripts/sign-release.mjs"), "utf8");
const source = ts.createSourceFile("sign-release.mjs", text, ts.ScriptTarget.Latest, true);
const run = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "run");
if (!run) throw new Error("The command runner is absent.");
for (const scenario of ["before-start", "after-child", "child-sigint"]) {
  const CANCELLED = Symbol("test-cancellation");
  let children = 0;
  let turns = 0;
  const context = {
    root: ".", CANCELLED, interrupted: scenario === "before-start",
    nextTurn: async () => {
      turns++;
      if (scenario === "after-child" && turns === 2) context.interrupted = true;
    },
    spawn: () => {
      children++;
      const child = new EventEmitter();
      child.stdout = child.stderr = null;
      queueMicrotask(() => child.emit("close", 0, scenario === "child-sigint" ? "SIGINT" : null));
      return child;
    },
  };
  const outcome = await runInNewContext(`${run.getText(source)}\nrun(["unused", []]);`, context);
  const expectedChildren = scenario === "before-start" ? 0 : 1;
  if (outcome !== CANCELLED || children !== expectedChildren)
    throw new Error(`Unexpected cancellation outcome for ${scenario}.`);
  console.log(JSON.stringify({ scenario, returnedCancellation: true, inertChildren: children }));
}
