import { describe, expect, it, vi } from "vitest";
import { inputFile } from "../src/cli/output-questions.js";
import { testPath } from "./helpers/test-folders.js";

const fault = vi.hoisted(() => ({ path: "", code: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    stat: async (...args: Parameters<typeof original.stat>) => {
      if (String(args[0]) === fault.path)
        throw Object.assign(new Error("Synthetic file lookup failure."), { code: fault.code });
      return original.stat(...args);
    },
  };
});

describe("a file that the menu cannot look at", () => {
  it.each([
    ["ENOENT", "there-no-such-file-check-name-folder"],
    ["ENOTDIR", "there-no-such-file-check-name-folder"],
    ["EACCES", "file-cannot-be-looked-at"],
    ["EIO", "file-cannot-be-looked-at"],
  ])("keeps %s distinct from a different refusal condition", async (code, refusal) => {
    fault.path = await testPath("mnemocode-lookup-fault-", "record.txt");
    fault.code = code;
    try {
      await expect(inputFile(fault.path, 1)).rejects.toMatchObject({
        code: `cli.output-questions.${refusal}`,
        cause: { code },
      });
    } finally {
      fault.path = "";
    }
  });
});
