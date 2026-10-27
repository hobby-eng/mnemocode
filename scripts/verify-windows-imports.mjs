// W-DLL-SEARCH's release gate (docs/design/platform/protections.json): every DLL that a Windows
// executable imports, directly or delay-loaded, is in the stored KnownDLL list or is an API set,
// so the loader takes it from the system and never from the executable's folder, where a planted
// DLL would wait (Microsoft's DLL planting). The GNU target cannot set DependentLoadFlags: the
// MinGW-w64 libraries of the pinned build define no `_load_config_used`, without which rust-lld's
// `--dependent-load-flag` has no effect (increment 0's probe, 2026-10-27).
//
//   node scripts/verify-windows-imports.mjs <file.exe> [knowndlls.json]
//       lists the imports; with the list (scripts/knowndlls.json), fails on any import outside it
import { readFileSync } from "node:fs";

/** The PE data directories this reads: imports and delay-load imports. */
const IMPORT_DIRECTORY = 1;
const DELAY_IMPORT_DIRECTORY = 13;
/** API sets resolve through the loader's schema, never through a search of folders. */
const API_SET = /^(?:api|ext)-ms-[a-z0-9-]+\.dll$/u;

/** The sections of a PE file, to map relative virtual addresses to file offsets. */
function sections(bytes, peOffset) {
  const count = bytes.readUInt16LE(peOffset + 6);
  const optionalSize = bytes.readUInt16LE(peOffset + 20);
  const first = peOffset + 24 + optionalSize;
  return Array.from({ length: count }, (_, index) => {
    const at = first + index * 40;
    return {
      virtualAddress: bytes.readUInt32LE(at + 12),
      virtualSize: Math.max(bytes.readUInt32LE(at + 8), bytes.readUInt32LE(at + 16)),
      rawOffset: bytes.readUInt32LE(at + 20),
    };
  });
}

/** The file offset of a relative virtual address. */
function offsetOf(rva, table) {
  const section = table.find(
    (entry) => rva >= entry.virtualAddress && rva < entry.virtualAddress + entry.virtualSize,
  );
  if (section === undefined) throw new Error(`address 0x${rva.toString(16)} is in no section`);
  return rva - section.virtualAddress + section.rawOffset;
}

/** The NUL-terminated ASCII name at a relative virtual address. */
function nameAt(bytes, rva, table) {
  const start = offsetOf(rva, table);
  return bytes.toString("latin1", start, bytes.indexOf(0, start));
}

/** The names of the DLLs a PE32+ file imports, directly and delay-loaded, in file order. */
export function importedDlls(bytes) {
  if (bytes.toString("latin1", 0, 2) !== "MZ") throw new Error("not a PE file (no MZ header)");
  const peOffset = bytes.readUInt32LE(0x3c);
  if (bytes.toString("latin1", peOffset, peOffset + 4) !== "PE\0\0")
    throw new Error("no PE header");
  const optional = peOffset + 24;
  if (bytes.readUInt16LE(optional) !== 0x20b) throw new Error("not a PE32+ (64-bit) file");
  const directory = (index) => bytes.readUInt32LE(optional + 112 + index * 8);
  const table = sections(bytes, peOffset);
  const names = [];
  // An import descriptor is 20 bytes, its name at offset 12; a delay-load one 32, its name at 4.
  for (const [index, size, nameField] of [
    [IMPORT_DIRECTORY, 20, 12],
    [DELAY_IMPORT_DIRECTORY, 32, 4],
  ]) {
    const rva = directory(index);
    if (rva === 0) continue;
    for (let at = offsetOf(rva, table); bytes.readUInt32LE(at + nameField) !== 0; at += size)
      names.push(nameAt(bytes, bytes.readUInt32LE(at + nameField), table));
  }
  return names;
}

const [file, listFile] = process.argv.slice(2);
if (file === undefined || process.argv.length > 4) {
  process.stderr.write(
    "usage: node scripts/verify-windows-imports.mjs <file.exe> [knowndlls.json]\n",
  );
  process.exit(2);
}
const imports = importedDlls(readFileSync(file));
if (listFile === undefined) {
  process.stdout.write(imports.map((name) => `${name}\n`).join(""));
} else {
  const known = new Set(
    JSON.parse(readFileSync(listFile, "utf8")).dlls.map((name) => name.toLowerCase()),
  );
  const outside = imports.filter(
    (name) => !known.has(name.toLowerCase()) && !API_SET.test(name.toLowerCase()),
  );
  if (outside.length > 0) {
    process.stderr.write(
      `${file} imports DLLs that are neither KnownDLLs nor API sets: ${outside.join(", ")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`${file}: ${imports.length} imports, each a KnownDLL or an API set\n`);
}
