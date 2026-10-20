import { describe, expect, it } from "vitest";
import { ErrorCatalog, suppliedMessage } from "../src/core/error-catalog.js";
import { errorCode } from "../src/core/refusal.js";
import { scriptExports } from "./helpers/script-exports.js";

const catalog = new ErrorCatalog("fixture", {
  missing: () => "An input is required.",
  count: { kind: "range", text: (count: string) => `The count ${count} is out of range.` },
  shape: { kind: "type", text: () => "That input has the wrong shape." },
});

/** An untyped host call, with the method bound and Reflect's result kept unknown. */
function fromUntypedHost(code: unknown): unknown {
  const result: unknown = Reflect.apply(catalog.create.bind(catalog), undefined, [code, []]);
  return result;
}

describe("module error catalogs", () => {
  it("builds an exact message from its stable code and keeps the ordinary cause", () => {
    const cause = new Error("Synthetic reader failure.");
    const error = catalog.create("missing", [], { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      code: "fixture.missing",
      message: "An input is required.",
      cause,
    });
    expect(String(error)).toBe("Error: An input is required.");
    expect(Object.keys(error)).toEqual(["code"]);
    expect(() => Object.defineProperty(error, "code", { value: "changed" })).toThrow(TypeError);
  });

  it("preserves native TypeError and RangeError identification", () => {
    const range = catalog.create("count", ["17"]);
    expect(range).toBeInstanceOf(RangeError);
    expect(range).toMatchObject({
      code: "fixture.count",
      name: "RangeError",
      message: "The count 17 is out of range.",
    });
    const type = catalog.create("shape", []);
    expect(type).toBeInstanceOf(TypeError);
    expect(type).toMatchObject({
      code: "fixture.shape",
      message: "That input has the wrong shape.",
    });
  });

  it("refuses inherited and unknown codes without repeating them", () => {
    for (const code of ["__proto__", "constructor", "synthetic-private-value"]) {
      // Reflect calls the public seam as an untyped JavaScript host would.
      expect(() => fromUntypedHost(code)).toThrow("Unknown module error code.");
      try {
        fromUntypedHost(code);
      } catch (error) {
        expect(error).toMatchObject({ code: "error-catalog.unknown-code" });
        expect(String(error)).not.toContain(code);
      }
    }
  });

  it("freezes its static definitions rather than allowing a code's meaning to change", () => {
    const definitions = {
      failed: { kind: "type" as const, text: () => "The operation failed." },
    };
    const owned = new ErrorCatalog("owned", definitions);
    expect(Object.isFrozen(definitions)).toBe(true);
    expect(Object.isFrozen(definitions.failed)).toBe(true);
    expect(() => (definitions.failed.text = () => "Changed.")).toThrow(TypeError);
    expect(owned.create("failed", []).message).toBe("The operation failed.");
  });

  it("passes a message factory's operational failure through unchanged", () => {
    const cause = new Error("Synthetic formatter failure.");
    const failed = new ErrorCatalog("fixture", {
      failed: (): string => {
        throw cause;
      },
    });
    expect(() => failed.create("failed", [])).toThrow(cause);
  });

  it("uses one adapter for wording that already belongs to a shared rule", () => {
    const owned = new ErrorCatalog("fixture", { refused: suppliedMessage });
    expect(owned.create("refused", ["A shared rule refused it."])).toMatchObject({
      code: "fixture.refused",
      message: "A shared rule refused it.",
    });
  });

  it("reads an external Error's code once and refuses non-errors and non-string codes", () => {
    let reads = 0;
    const external = new Error("Synthetic external failure.");
    Object.defineProperty(external, "code", {
      get: () => {
        reads += 1;
        return "EIO";
      },
    });
    expect(errorCode(external)).toBe("EIO");
    expect(reads).toBe(1);
    expect(errorCode({ code: "EIO" })).toBeUndefined();
    expect(errorCode(Object.assign(new Error("Synthetic fault."), { code: 17 }))).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });
});

describe("cross-runtime error identification", () => {
  it("keeps the import-free catalog guard in step with the refusal reader", () => {
    for (const [value, matched] of [
      [undefined, false],
      [{ code: "fixture.missing" }, false],
      [new Error("Synthetic uncoded failure."), false],
      [Object.assign(new Error("Synthetic numeric code."), { code: 17 }), false],
      [Object.assign(new Error("Synthetic string code."), { code: "fixture.missing" }), true],
      [Object.assign(new Error("Synthetic unrelated code."), { code: "EIO" }), false],
    ] as const) {
      expect(catalog.matches(value, ["missing"])).toBe(matched);
      expect(errorCode(value) === "fixture.missing").toBe(matched);
    }
    for (const read of [
      (error: Error) => catalog.matches(error, ["missing"]),
      (error: Error) => errorCode(error),
    ]) {
      let reads = 0;
      const error = new Error("Synthetic changing external code.");
      Object.defineProperty(error, "code", {
        configurable: true,
        get: () => {
          reads += 1;
          return reads === 1 ? "fixture.missing" : "EIO";
        },
      });
      read(error);
      expect(reads).toBe(1);
      const fault = new Error("Synthetic code getter failure.");
      Object.defineProperty(error, "code", {
        configurable: true,
        get: () => {
          throw fault;
        },
      });
      expect(() => read(error)).toThrow(fault);
    }
  });
});

describe("executable failure preservation", () => {
  it("keeps every cause of a failed executable publication and rollback", async () => {
    const { PublicationRollbackError } = await scriptExports<{
      PublicationRollbackError: new (causes: readonly Error[], staging: string) => unknown;
    }>("scripts/executable-build-errors.mjs", { PublicationRollbackError: "function" });
    const causes = [
      new Error("Synthetic publication failure."),
      new Error("Synthetic rollback failure."),
    ];
    const error = new PublicationRollbackError(causes, "synthetic-staging");
    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toMatchObject({
      code: "scripts.build-executable.publication-and-rollback-failed",
      message: "Publication and rollback failed; backups remain in synthetic-staging.",
      errors: causes,
    });
    expect(String(error)).toBe(
      "AggregateError: Publication and rollback failed; backups remain in synthetic-staging.",
    );
    expect(() => Object.defineProperty(error, "code", { value: "changed" })).toThrow(TypeError);
  });
});
