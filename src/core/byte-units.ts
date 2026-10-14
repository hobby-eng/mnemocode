/** Bytes in a mebibyte (IEC 80000-13), shared by host-neutral and file input limits. */
export const MEBIBYTE = 1024 * 1024;

/** A limit of `bytes`, whole mebibytes, as the messages name it, such as "1 MiB". */
export function limitName(bytes: number): string {
  return `${bytes / MEBIBYTE} MiB`;
}

/** The refusal of an input larger than its limit: "`what` exceeds the 1 MiB safety limit." */
export class InputTooLarge extends Error {
  constructor(what: string, limit: number) {
    super(`${what} exceeds the ${limitName(limit)} safety limit.`);
    this.name = "InputTooLarge";
  }
}
