// Admits real, attached byte arrays across realms, without trusting prototypes or own getters:
// the candidate list and the checked SSKR bridge read the bytes that a host gives them through it.
import { defined } from "./defined.js";

const TYPED_ARRAY = defined(Reflect.getPrototypeOf(Uint8Array.prototype));
const ARRAY_NAME = defined(
  defined(Reflect.getOwnPropertyDescriptor(TYPED_ARRAY, Symbol.toStringTag)).get,
);
const BYTE_LENGTH = defined(
  defined(Reflect.getOwnPropertyDescriptor(TYPED_ARRAY, "byteLength")).get,
);
// oxlint-disable-next-line typescript/unbound-method -- Reflect.apply binds the admitted storage as this.
const VALUES = Uint8Array.prototype.values;

/**
 * The intrinsic length of `value`, in bytes, or undefined for a wrong kind, spoofed or detached
 * array. Never throws: a value that the intrinsic getters refuse gives undefined too.
 */
export function byteArrayLength(value: unknown): number | undefined {
  if (!ArrayBuffer.isView(value)) return undefined;
  try {
    if (ARRAY_NAME.call(value) !== "Uint8Array") return undefined;
    // Creating the intrinsic iterator validates attachment without reading or copying bytes.
    Reflect.apply(VALUES, value, []);
    // The intrinsic getter on the admitted storage returns its numeric length, not an own field;
    // the standard library types it as any, so the number is checked rather than assumed.
    const length: unknown = BYTE_LENGTH.call(value);
    return typeof length === "number" ? length : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether `value` has attached Uint8Array storage (byteArrayLength), including Buffer and subarray
 * views.
 */
export function isByteArray(value: unknown): value is Uint8Array {
  return byteArrayLength(value) !== undefined;
}
