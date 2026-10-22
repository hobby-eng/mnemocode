import { describe, expect, it } from "vitest";
import { prepareEncode } from "../src/cli/encode-command.js";
import { runReEncode } from "../src/cli/re-encode-command.js";
import { ShareSet } from "../src/sskr/share-set.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { writeShare } from "../src/sskr/transport.js";
import { runBuiltCliSync as cli } from "./helpers/built-cli.js";

describe("additional original-phrase display is words only", () => {
  it.each(["codes", "both"] as const)(
    "refuses --show-original %s before Encode or Re-encode reads a secret",
    async (form) => {
      for (const shares of [false, true]) {
        const args = {
          "ask-secrets": true,
          mode: "seedshift",
          "show-original": form,
          format: "3",
          ...(shares ? { sskr: true, threshold: "2", shares: "3" } : {}),
        };
        await expect(prepareEncode(args)).rejects.toThrow("--show-original");
        await expect(runReEncode(args)).rejects.toThrow("--show-original");
      }
    },
  );

  it.each(["indexes", "unicode", "colors", "colors-unicode"] as const)(
    "refuses an additional unmasked %s backup beside shares before asking for the phrase",
    async (format) => {
      await expect(
        prepareEncode({
          "ask-secrets": true,
          mode: "direct",
          sskr: true,
          threshold: "2",
          shares: "3",
          format,
        }),
      ).rejects.toThrow("only as English words");
    },
  );

  it.each(["ur", "words", "indexes", "unicode", "colors", "colors-unicode"] as const)(
    "does not turn an original restored from %s shares into another code block",
    async (format) => {
      using set = await ShareSet.restore(
        SSKR_SET_VECTOR.shares.slice(0, 2).map((share) => writeShare(share, format)),
        nodeSharePlatform,
      );
      expect(set.mnemonic).toBe(SSKR_SET_VECTOR.phrase);
      expect(set.backup(SSKR_SET_VECTOR.phrase)).toBeUndefined();
      expect(set.backup(` ${SSKR_SET_VECTOR.phrase.toUpperCase()}\n`)).toBeUndefined();
      const result = cli([
        "sskr-combine",
        ...SSKR_SET_VECTOR.shares
          .slice(0, 2)
          .flatMap((share) => ["--share", writeShare(share, format)]),
      ]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(
        `Original seed phrase, the wallet's:\n${SSKR_SET_VECTOR.phrase}\n`,
      );
    },
  );
});
