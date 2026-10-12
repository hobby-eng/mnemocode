// A fresh process observes imports only; it does not open the menu or run a self-test.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const loaded = () =>
  Object.keys(require.cache).filter((path) =>
    /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:jsqr|pngjs)\//u.test(path),
  );
assert.equal(loaded().length, 0);
await import("../../../src/cli/menu.js");
const packages = loaded();
assert.ok(packages.some((path) => path.includes("/jsqr/")));
assert.ok(packages.some((path) => path.includes("/pngjs/")));
console.log(
  JSON.stringify({ coldMenuInitializes: ["jsqr", "pngjs"], modules: packages.length }, null, 2),
);
