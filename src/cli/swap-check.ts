// Whether swap may write this program's memory, the seed phrase included, to a disk unencrypted,
// where it can stay for years; Linux only, as mhfe checks it (src/bin/mhfe/protect.rs). Every swap
// area in /proc/swaps counts as safe when its block device is dm-crypt, directly or below LVM, or
// zram, which lives in memory. A swap file is traced to the device that holds it.

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { printableText } from "./terminal-style.js";
import { ErrorCatalog } from "../core/error-catalog.js";

const ERRORS = new ErrorCatalog("cli.swap-check", {
  "swap-table-unreadable": () => "The table of swap areas does not have the form Linux writes.",
});

/** The dm uuid of a dm-crypt device starts with this (cryptsetup). */
const CRYPT_UUID_PREFIX = "CRYPT-";

/**
 * The columns of /proc/swaps, which its first line names, and which each area's line fills
 * (Linux, mm/swapfile.c, swap_show).
 */
const SWAP_COLUMNS = ["Filename", "Type", "Size", "Used", "Priority"] as const;
/** The types of swap area that /proc/swaps names: a block device, or a file on one. */
const SWAP_TYPES: ReadonlySet<string> = new Set(["partition", "file"]);
/**
 * /proc/swaps writes a space, a tab, a line break and a backslash in a path as a backslash and
 * three octal digits (\040, \011, \012, \134; Linux, mangle_path): an ASCII character.
 */
const PROC_ESCAPE = /\\([0-7]{3})/gu;
/** The highest code of an ASCII character, the most that an escape of /proc/swaps stands for. */
const MAX_ASCII = 0x7f;

/** Refuses a table of swap areas that does not have the form of /proc/swaps. */
function unreadableTable(): Error {
  return ERRORS.create("swap-table-unreadable", []);
}

/** A path as /proc/swaps writes it, its escapes undone; refused when one is not an escape. */
function unescapeProcPath(path: string): string {
  const unescaped = path.replace(PROC_ESCAPE, (_, octal: string) => {
    const code = parseInt(octal, 8);
    if (code > MAX_ASCII) throw unreadableTable();
    return String.fromCharCode(code);
  });
  // Every backslash starts an escape, as the kernel writes a backslash itself as one.
  if (path.replace(PROC_ESCAPE, "").includes("\\")) throw unreadableTable();
  return unescaped;
}

/** A swap area as /proc/swaps lists it: its path, and whether it is a file. */
interface SwapArea {
  readonly path: string;
  readonly file: boolean;
}

/**
 * The swap areas that the text of /proc/swaps lists, refused as a whole where the text does not
 * have its form: a first line other than its columns, or a line of an area that does not fill them
 * or names another type, such as a line cut short. Nothing in such a table can be trusted, and an
 * area left out would leave out its warning.
 */
function swapAreas(table: string): SwapArea[] {
  const lines = table.split("\n");
  // The table ends with a line break, after which nothing follows.
  if (lines.at(-1) === "") lines.pop();
  const [header, ...areas] = lines.map((line) => line.trim().split(/\s+/u));
  if (header?.join(" ") !== SWAP_COLUMNS.join(" ")) throw unreadableTable();
  return areas.map((fields) => {
    const [path, type] = fields;
    if (fields.length !== SWAP_COLUMNS.length || path === undefined || type === undefined)
      throw unreadableTable();
    if (!SWAP_TYPES.has(type)) throw unreadableTable();
    return { path: unescapeProcPath(path), file: type === "file" };
  });
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

/** Where Linux lists the swap areas in use, below the file-system root. */
const SWAP_TABLE = "proc/swaps";

/** The start of the warning about swap, for areas that are not encrypted or not known to be. */
const SWAP_RISK = "Swap may write this memory to the disk unencrypted";

/**
 * The swap areas that are not encrypted, or of which MnemoCode cannot tell, by their path in
 * /proc/swaps; empty without swap and on other systems. `root` is the file-system root, so that
 * tests can give a /proc and /sys of their own. Throws when /proc/swaps cannot be read, as under a
 * permission model that denies it, or does not have its form (swap-table-unreadable): then
 * nothing is known about swap, which is not the same as no swap (swapWarning, AUD-014-SEC002).
 */
export function unencryptedSwap(root = "/"): string[] {
  if (root === "/" && process.platform !== "linux") return [];
  const table = readFileSync(join(root, SWAP_TABLE), "utf8");
  const risky: string[] = [];
  for (const { path, file } of swapAreas(table)) {
    const name = file ? deviceOfFile(root, path) : deviceName(root, path);
    if (name === undefined || !encrypted(root, name)) risky.push(path);
  }
  return risky;
}

/**
 * The warning about swap that comes before a secret: the areas that may write memory to a disk
 * unencrypted, or that MnemoCode cannot tell at all because it cannot read /proc/swaps or its
 * form; undefined when there is no swap or all of it is safe. Any failure to read the table warns:
 * a warning too many is safe, a missing one is not.
 */
export function swapWarning(root = "/"): string | undefined {
  let risky: string[];
  try {
    risky = unencryptedSwap(root);
  } catch {
    return `${SWAP_RISK}: MnemoCode cannot read /${SWAP_TABLE} to tell`;
  }
  return risky.length === 0 ? undefined : `${SWAP_RISK}: ${risky.map(printableText).join(", ")}`;
}
