// Every Uint8Array that a piece of code makes while it runs, however it makes it (new, from, a
// subarray), so that a test can check that bytes holding a secret were wiped. The global
// constructor is replaced only while `read` runs.

/** What `read` left: the arrays made meanwhile, and its refusal, if it refused. */
export interface MadeArrays {
  readonly arrays: readonly Uint8Array[];
  readonly refusal?: string;
}

export function madeArrays(read: () => unknown): MadeArrays {
  const arrays: Uint8Array[] = [];
  const Original = globalThis.Uint8Array;
  class Captured extends Original {
    constructor(...args: ConstructorParameters<typeof Uint8Array>) {
      super(...args);
      arrays.push(this);
    }
  }
  // Set by Reflect: the subclass takes the same arguments, but its constructor has one signature
  // where Uint8ArrayConstructor declares one for each form of them.
  Reflect.set(globalThis, "Uint8Array", Captured);
  try {
    read();
    return { arrays };
  } catch (error) {
    return { arrays, refusal: error instanceof Error ? error.message : String(error) };
  } finally {
    globalThis.Uint8Array = Original;
  }
}

/** Whether every byte of `arrays` is zero. */
export function allWiped(arrays: readonly Uint8Array[]): boolean {
  return arrays.every((array) => array.every((byte) => byte === 0));
}
