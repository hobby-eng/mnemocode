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

let pending: Promise<SskrBridge> | undefined;

/**
 * Node-only loader. The public share transport and export modules do not load WASM. The bridge is
 * handed out only behind its checks (CheckedSskrBridge), so that no caller reaches an entry whose
 * arguments the glue would narrow unchecked (AUD-014-API008).
 */
export function sskrEngine(): Promise<SskrBridge> {
  return (pending ??= (async () => {
    const base = SSKR_ENGINE_FOLDER;
    const manifest = JSON.parse(
      new TextDecoder().decode(await readBundledFile(`${base}${SSKR_MANIFEST}`)),
    ) as Record<string, string>;
    const bridgePath = SSKR_BRIDGE;
    const binaryPath = SSKR_BINARY;
    // Inside the single executable the bridge runs from the bundle; its embedded copy, checked
    // here, is the same file, and the executable as a whole is checked against SHA256SUMS.
    const bridge = await readBundledFile(`${base}${bridgePath}`);
    const binary = await readBundledFile(`${base}${binaryPath}`);
    for (const [path, bytes] of [
      [bridgePath, bridge],
      [binaryPath, binary],
    ] as const) {
      if (createHash("sha256").update(bytes).digest("hex") !== manifest[path]) {
        throw new Error("SSKR dependency integrity check failed. No secret was processed.");
      }
    }
    // A literal, which TypeScript and the bundler need: the bridge of SSKR_BRIDGE, which a test
    // keeps in step.
    const engine: typeof Engine = await import("../../sskr-wasm/generated/recovery_sskr_wasm.js");
    // Initialise from the exact WASM bytes verified above, not a second filesystem read.
    engine.initSync({ module: binary });
    return new CheckedSskrBridge(engine);
  })().catch((error) => {
    pending = undefined;
    throw error;
  }));
}
