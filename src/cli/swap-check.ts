// Whether swap may write this program's memory, the seed phrase included, to a disk unencrypted,
// where it can stay for years; Linux only, as mhfe checks it (src/bin/mhfe/protect.rs). Every swap
// area in /proc/swaps counts as safe when its block device is dm-crypt, directly or below LVM, or
// zram, which lives in memory. A swap file is traced to the device that holds it.

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** The dm uuid of a dm-crypt device starts with this (cryptsetup). */
const CRYPT_UUID_PREFIX = "CRYPT-";

/** /proc/swaps writes a space in a path as \040, and other special bytes in octal too. */
function unescapeProcPath(path: string): string {
  return path.replace(/\\([0-7]{3})/gu, (_, octal: string) =>
    String.fromCharCode(parseInt(octal, 8)),
  );
}

/** The kernel name of a block device, such as dm-0 or sda2, from its path in /dev. */
function deviceName(root: string, path: string): string | undefined {
  try {
    return basename(realpathSync(join(root, path)));
  } catch {
    return undefined;
  }
}

/** The block device that holds a swap file, by the device number of the file (Linux dev_t). */
function deviceOfFile(root: string, path: string): string | undefined {
  try {
    const device = statSync(join(root, path), { bigint: true }).dev;
    const major = Number(((device >> 8n) & 0xfffn) | ((device >> 32n) & ~0xfffn));
    const minor = Number((device & 0xffn) | ((device >> 12n) & ~0xffn));
    return basename(realpathSync(join(root, "sys/dev/block", `${major}:${minor}`)));
  } catch {
    return undefined;
  }
}

/** Whether a block device is encrypted: dm-crypt itself, zram, or built only on such devices. */
function encrypted(root: string, name: string, depth = 0): boolean {
  // Device stacks are shallow; a loop in a strange /sys must not hang the check.
  if (depth > 8) return false;
  if (name.startsWith("zram")) return true;
  const device = join(root, "sys/class/block", name);
  try {
    if (readFileSync(join(device, "dm/uuid"), "utf8").startsWith(CRYPT_UUID_PREFIX)) return true;
  } catch {
    // Not a device-mapper device.
  }
  let slaves: string[];
  try {
    slaves = readdirSync(join(device, "slaves"));
  } catch {
    return false;
  }
  return slaves.length > 0 && slaves.every((slave) => encrypted(root, slave, depth + 1));
}

/**
 * The swap areas that are not encrypted, or of which MnemoCode cannot tell, by their path in
 * /proc/swaps; empty without swap and on other systems. `root` is the file-system root, so that
 * tests can give a /proc and /sys of their own.
 */
export function unencryptedSwap(root = "/"): string[] {
  if (root === "/" && process.platform !== "linux") return [];
  let table: string;
  try {
    table = readFileSync(join(root, "proc/swaps"), "utf8");
  } catch {
    return [];
  }
  const risky: string[] = [];
  // The first line names the columns: Filename Type Size Used Priority.
  for (const line of table.split("\n").slice(1)) {
    const [rawPath, type] = line.trim().split(/\s+/u);
    if (rawPath === undefined || rawPath === "" || type === undefined) continue;
    const path = unescapeProcPath(rawPath);
    const name = type === "file" ? deviceOfFile(root, path) : deviceName(root, path);
    if (name === undefined || !encrypted(root, name)) risky.push(path);
  }
  return risky;
}
