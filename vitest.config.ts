import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Many tests start the built CLI several times, and every start runs the core
    // self-test. Hosted CI runners need several times longer than a developer machine.
    // Tests import renderers directly, so the Node.js platform is installed for every file.
    setupFiles: ["src/export/platform-node.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
