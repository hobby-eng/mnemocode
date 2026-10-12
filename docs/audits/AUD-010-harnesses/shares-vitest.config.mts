// AUD-010 "shares": the vitest configuration of the probes that replace a module (vi.mock). Their
// files end in .probe.ts, so the repository's own `vitest run` never collects them.
// Run from the repository root:
//   pnpm exec vitest run --config docs/audits/AUD-010-harnesses/shares-vitest.config.mts <file>
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../../", import.meta.url));

export default defineConfig({
  root,
  test: {
    include: ["docs/audits/AUD-010-harnesses/shares-*.probe.ts"],
    setupFiles: ["src/export/platform-node.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Every compared value is printed by the probes themselves.
    reporters: ["verbose"],
  },
});
