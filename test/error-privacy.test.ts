// Public BIP39 data only. Wrong selector fields must never copy a seed phrase into a refusal.
import { describe, expect, it } from "vitest";
import { serializeRecord } from "../src/record.js";
import { daysInMonth } from "../src/core/dates.js";
import { runCommandLine } from "../src/cli/command-line.js";
import { parseArguments, assertAllowedArguments } from "../src/cli/arguments.js";
import { optionLabel } from "../src/cli/option-copy.js";

const PUBLIC_PHRASE = "abandon ".repeat(11) + "about";

/** Calls a typed seam as an untyped host, keeping Reflect's result unknown. */
function callUntyped(fn: unknown, parameters: readonly unknown[]): unknown {
  if (typeof fn !== "function") throw new Error("The test seam is not a function.");
  const result: unknown = Reflect.apply(fn, undefined, parameters);
  return result;
}

/** The original refusal, validated without a type assertion. */
function refused(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("The synthetic invalid request was accepted.");
}

describe("secret-safe selector refusals", () => {
  it.each([
    [PUBLIC_PHRASE, "indexes"],
    ["direct", PUBLIC_PHRASE],
  ])("conceals an invalid record mode or format", (mode, format) => {
    const error = refused(() => callUntyped(serializeRecord, [mode, format, "synthetic-payload"]));
    expect(error.message).not.toContain(PUBLIC_PHRASE);
    expect(error).toMatchObject({
      code: mode === "direct" ? "record.unsupported-format" : "record.unsupported-mode",
    });
  });

  it("does not coerce a rejected selector that may own private data", () => {
    let coercions = 0;
    const selector = {
      toString: () => {
        coercions += 1;
        return PUBLIC_PHRASE;
      },
    };
    const error = refused(() =>
      callUntyped(serializeRecord, [selector, "indexes", "synthetic-payload"]),
    );
    expect(error.message).toBe("Unsupported MnemoCode record mode.");
    expect(coercions).toBe(0);
  });

  it("conceals text passed where a month number was expected", () => {
    const error = refused(() => callUntyped(daysInMonth, [2026, PUBLIC_PHRASE]));
    expect(error.message).toBe("There is no such calendar month.");
  });

  for (const argv of [[PUBLIC_PHRASE], ["help", PUBLIC_PHRASE]])
    it("conceals an unknown command or help topic", async () => {
      await expect(runCommandLine(argv)).rejects.not.toThrow(PUBLIC_PHRASE);
      await expect(runCommandLine(argv)).rejects.toThrow("There is no such command");
    });

  it("conceals an unknown option in labels, missing values and unsupported settings", () => {
    expect(optionLabel(PUBLIC_PHRASE)).toBe("unknown option");
    for (const action of [
      () => parseArguments([`--${PUBLIC_PHRASE}`]),
      () => assertAllowedArguments(parseArguments([`--${PUBLIC_PHRASE}`, "x"]), "table", ["word"]),
    ]) {
      const error = refused(action);
      expect(error.message).not.toContain(PUBLIC_PHRASE);
      expect(error.message).toContain("unknown option");
    }
  });
});
