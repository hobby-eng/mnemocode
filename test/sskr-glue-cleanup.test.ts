import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const glue = await readFile(
  new URL("../sskr-wasm/generated/recovery_sskr_wasm.js", import.meta.url),
  "utf8",
);
const OUTPUT = "Synthetic public share output.";
const POINTER = 4096;
const FRAME = 64;
const bytes = new TextEncoder().encode(OUTPUT);
type Create = (
  secret: Uint8Array,
  threshold: number,
  groups: Uint8Array,
  seed: Uint8Array,
  encoding?: number,
) => string;
type Recover = (records: string, encoding?: number) => Uint8Array;
interface GlueContext {
  Uint8Array: typeof Uint8Array;
  DataView: typeof DataView;
  TextDecoder: typeof TextDecoder;
  TextEncoder: typeof TextEncoder;
  injected: {
    memory: { buffer: ArrayBuffer };
    __wbindgen_export: (size: number) => number;
    __wbindgen_export2: (pointer: number, size: number, alignment: number) => void;
    __wbindgen_add_to_stack_pointer: (delta: number) => number;
    create_sskr_shares: (frame: number) => void;
    create_sskr_shares_formatted: (frame: number) => void;
    recover_sskr_shares: (frame: number) => void;
    recover_sskr_shares_formatted: (frame: number) => void;
  };
  invoke?: Create;
  recover?: Recover;
}

afterEach(() => vi.restoreAllMocks());

/** Execute the shipped offline glue against a deterministic allocation/free boundary. */
function fixture(
  entry: string,
  mode: "success" | "decode-failure" | "copy-failure" | "fill-failure",
) {
  const buffer = new ArrayBuffer(8192);
  const events: string[] = [];
  const freed: Uint8Array[] = [];
  const failure = new Error("Synthetic glue boundary failure.");
  let next = 1024;
  const returned = (frame: number) => {
    new Uint8Array(buffer, POINTER, bytes.length).set(bytes);
    const view = new DataView(buffer);
    for (const [offset, value] of [
      [0, POINTER],
      [4, bytes.length],
      [8, 0],
      [12, 0],
    ])
      view.setInt32(frame + offset!, value!, true);
  };
  const context: GlueContext = {
    Uint8Array,
    DataView,
    TextDecoder,
    TextEncoder,
    injected: {
      memory: { buffer },
      __wbindgen_export: (size) => {
        const pointer = next;
        next += size;
        return pointer;
      },
      __wbindgen_export2: (pointer, size, _alignment) => {
        expect(pointer).toBe(POINTER);
        expect(size).toBe(bytes.length);
        events.push("free");
        freed.push(new Uint8Array(buffer, pointer, size).slice());
      },
      __wbindgen_add_to_stack_pointer: (delta) => {
        events.push(delta < 0 ? "enter" : "leave");
        return FRAME;
      },
      create_sskr_shares: returned,
      create_sskr_shares_formatted: returned,
      recover_sskr_shares: returned,
      recover_sskr_shares_formatted: returned,
    },
  };
  // Evaluate repository-owned, offline generated source only; no untrusted source is evaluated.
  const executable = glue.replace("export { initSync };", "").replace(/^export /gmu, "");
  const binding = entry.startsWith("recover_") ? "recover" : "invoke";
  runInNewContext(
    executable + "\nwasm = injected; globalThis." + binding + " = " + entry + ";",
    context,
  );
  // oxlint-disable-next-line typescript/unbound-method -- the intrinsic uses its explicit receiver through call.
  const fill = Uint8Array.prototype.fill;
  vi.spyOn(Uint8Array.prototype, "fill").mockImplementation(function (
    this: Uint8Array,
    value,
    start,
    end,
  ) {
    if (this.buffer === buffer && this.byteOffset === POINTER && this.length === bytes.length) {
      events.push("fill");
      if (mode === "fill-failure") throw failure;
    }
    return fill.call(this, value, start, end);
  });
  if (mode === "decode-failure")
    vi.spyOn(TextDecoder.prototype, "decode").mockImplementationOnce(() => {
      throw failure;
    });
  if (mode === "copy-failure")
    vi.spyOn(Uint8Array.prototype, "slice").mockImplementationOnce(() => {
      throw failure;
    });
  const invoke = context.invoke;
  const recover = context.recover;
  return {
    call: () => {
      if (binding === "recover") {
        if (recover === undefined) throw new Error("The generated recovery entry must exist.");
        return recover("Synthetic public shares.", 0);
      }
      if (invoke === undefined) throw new Error("The generated creation entry must exist.");
      return invoke(new Uint8Array(16), 1, Uint8Array.of(2, 3), new Uint8Array(32), 0);
    },
    events,
    freed,
    failure,
  };
}

describe.each(["create_sskr_shares", "create_sskr_shares_formatted"])(
  "SSKR generated %s allocation cleanup",
  (entry) => {
    it("fills before exactly one free after a successful host decode", () => {
      const state = fixture(entry, "success");
      expect(state.call()).toBe(OUTPUT);
      expect(state.events).toEqual(["enter", "fill", "leave", "free"]);
      expect(state.freed).toEqual([new Uint8Array(bytes.length)]);
    });

    it("fills before exactly one free when the host decoder throws", () => {
      const state = fixture(entry, "decode-failure");
      expect(state.call).toThrow(state.failure);
      expect(state.events).toEqual(["enter", "fill", "leave", "free"]);
      expect(state.freed).toEqual([new Uint8Array(bytes.length)]);
    });

    it("restores the frame and frees exactly once even when fill throws", () => {
      const state = fixture(entry, "fill-failure");
      expect(state.call).toThrow(state.failure);
      expect(state.events).toEqual(["enter", "fill", "leave", "free"]);
      // A failed wipe cannot promise zero bytes; release must still happen.
      expect(state.freed).toEqual([bytes]);
    });
  },
);

/** Require the same thrown object, including when cleanup is entered after a host failure. */
function expectSameFailure(call: () => unknown, failure: Error): void {
  let observed: unknown;
  try {
    call();
  } catch (error) {
    observed = error;
  }
  expect(observed).toBe(failure);
}

describe.each(["recover_sskr_shares", "recover_sskr_shares_formatted"])(
  "SSKR generated %s allocation cleanup",
  (entry) => {
    it("copies the public bytes and fills before exactly one free", () => {
      const state = fixture(entry, "success");
      expect(state.call()).toEqual(bytes);
      expect(state.events).toEqual(["enter", "fill", "free", "leave"]);
      expect(state.freed).toEqual([new Uint8Array(bytes.length)]);
    });

    it("propagates the original host copy error while filling and freeing once", () => {
      const state = fixture(entry, "copy-failure");
      expectSameFailure(state.call, state.failure);
      expect(state.events).toEqual(["enter", "fill", "free", "leave"]);
      expect(state.freed).toEqual([new Uint8Array(bytes.length)]);
    });

    it("propagates the original fill error and still frees once and restores the stack", () => {
      const state = fixture(entry, "fill-failure");
      expectSameFailure(state.call, state.failure);
      expect(state.events).toEqual(["enter", "fill", "free", "leave"]);
      // The injected fill throws before writing; release cannot imply successful erasure.
      expect(state.freed).toEqual([bytes]);
    });
  },
);
