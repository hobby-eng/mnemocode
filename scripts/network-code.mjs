// Code that could reach the network or load a file: none of it may remain in a page's glue. One
// list for the build, which removes the loader (offline-glue.mjs), and for the `wasm` gate, which
// checks the built files (verify-wasm.mjs).

/** Patterns of code that reaches the network or loads a file by URL. */
const NETWORK_CODE = Object.freeze([
  /\bfetch\s*\(/u,
  /\bXMLHttpRequest\b/u,
  /\bWebSocket\b/u,
  /\bEventSource\b/u,
  /\bsendBeacon\b/u,
  /\bimport\.meta\b/u,
  /\bimport\s*\(/u,
]);

/** The first pattern of NETWORK_CODE that `text` holds, or undefined. */
export function networkCodeIn(text) {
  return NETWORK_CODE.find((pattern) => pattern.test(text));
}
