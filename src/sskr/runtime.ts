import { createHash } from "node:crypto";
import { readBundledFile } from "../bundled-files.js";
import {
  SSKR_BINARY,
  SSKR_BRIDGE,
  SSKR_ENGINE_FOLDER,
  SSKR_MANIFEST,
} from "../bundled-file-paths.js";
import type * as Engine from "../../sskr-wasm/generated/recovery_sskr_wasm.js";
import { CheckedSskrBridge, type SskrBridge } from "./bridge.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("sskr.runtime", {
  "sskr-dependency-integrity-check-failed-no-secret-was": () =>
    "SSKR dependency integrity check failed. No secret was processed.",
  "bundle-reader": {
    kind: "type",
    text: () => "The SSKR runtime needs a bundled-file reader.",
  },
});

// SHA-256 pins are lowercase hexadecimal digests, 256 bits / 4 bits per digit.
const SHA256_PIN = /^[0-9a-f]{64}$/u;

function enginePins(bytes: Uint8Array): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // A syntax error can retain manifest text. Return only the existing safe integrity refusal.
    throw ERRORS.create("sskr-dependency-integrity-check-failed-no-secret-was", []);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw ERRORS.create("sskr-dependency-integrity-check-failed-no-secret-was", []);
  const pins: Record<string, string> = {};
  for (const path of [SSKR_BRIDGE, SSKR_BINARY]) {
    const pin: unknown = Reflect.get(parsed, path);
    if (typeof pin !== "string" || !SHA256_PIN.test(pin))
      throw ERRORS.create("sskr-dependency-integrity-check-failed-no-secret-was", []);
    pins[path] = pin;
  }
  return pins;
}

/**
 * Node-only loader, with a bundled-file reader supplied by its host. One instance caches one
 * checked engine; a failed read or integrity check can be retried. It processes no secret before
 * both generated files match their pins. The public transport/export modules do not load WASM.
 */
export class SskrRuntime {
  readonly #read: typeof readBundledFile;
  #pending: Promise<SskrBridge> | undefined;

  /**
   * `read` reads a bundled file by its path, readBundledFile by default; throws
   * sskr.runtime.bundle-reader (a TypeError) when it is not a function. Nothing is read yet.
   */
  constructor(read: typeof readBundledFile = readBundledFile) {
    if (typeof read !== "function") throw ERRORS.create("bundle-reader", []);
    this.#read = read;
  }

  /** A checked bridge, cached only after its exact generated JS and WASM bytes are verified. */
  load(): Promise<SskrBridge> {
    return (this.#pending ??= this.#load().catch((error) => {
      this.#pending = undefined;
      throw error;
    }));
  }

  async #load(): Promise<SskrBridge> {
    const base = SSKR_ENGINE_FOLDER;
    const manifest = enginePins(await this.#read(`${base}${SSKR_MANIFEST}`));
    const bridgePath = SSKR_BRIDGE;
    const binaryPath = SSKR_BINARY;
    // Inside the single executable the bridge runs from the bundle; its embedded copy, checked
    // here, is the same file, and the executable as a whole is checked against SHA256SUMS.
    const bridge = await this.#read(`${base}${bridgePath}`);
    const binary = await this.#read(`${base}${binaryPath}`);
    for (const [path, bytes] of [
      [bridgePath, bridge],
      [binaryPath, binary],
    ] as const) {
      if (createHash("sha256").update(bytes).digest("hex") !== manifest[path]) {
        throw ERRORS.create("sskr-dependency-integrity-check-failed-no-secret-was", []);
      }
    }
    // A literal, which TypeScript and the bundler need: the bridge of SSKR_BRIDGE, which a test
    // keeps in step.
    const engine: typeof Engine = await import("../../sskr-wasm/generated/recovery_sskr_wasm.js");
    // Initialise from the exact WASM bytes verified above, not a second filesystem read.
    engine.initSync({ module: binary });
    return new CheckedSskrBridge(engine);
  }
}

const runtime = new SskrRuntime();

/** The package's checked bridge; the same Node API and singleton cache as before. */
export function sskrEngine(): Promise<SskrBridge> {
  return runtime.load();
}
