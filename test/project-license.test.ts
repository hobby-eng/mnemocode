// MnemoCode, its SSKR bridge included, is offered under the MIT license or the Apache License 2.0,
// at the recipient's option: the npm package declares both and ships both texts, and each
// executable's license notices carry both texts of MnemoCode and of the bridge.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SSKR_ENGINE_FOLDER } from "../src/bundled-file-paths.js";
import { executableNotices } from "./helpers/executable-notices.js";

/** The SPDX expression of MnemoCode's license. */
const LICENSE = "MIT OR Apache-2.0";
/** The files of the two licenses, each in the root and in the bridge's folder. */
const LICENSE_FILES = ["LICENSE-MIT", "LICENSE-APACHE"];
/** The first line of the MIT license and the title of the Apache License. */
const MIT_TITLE = "MIT License";
const APACHE_TITLE = /^\s+Apache License\n\s+Version 2\.0, January 2004\n/u;

/** The heading of the notices of MnemoCode and of its SSKR bridge, and the folder of their files. */
const NOTICE_SECTIONS: readonly { readonly title: string; readonly folder: string }[] = [
  { title: "MnemoCode", folder: "" },
  { title: "SSKR engine (sskr-wasm)", folder: SSKR_ENGINE_FOLDER },
];

/** The text of `file`. */
function text(file: string): string {
  return readFileSync(file, "utf8");
}

/** The notices from right below the heading `title`, which stands between two rules, to the end. */
function sectionOf(notices: string, title: string): string {
  const titled = notices.indexOf(`\n${title}\n`);
  expect(titled, title).toBeGreaterThan(-1);
  const rule = titled + title.length + 2;
  return notices.slice(notices.indexOf("\n", rule) + 1);
}

describe("MnemoCode's license", () => {
  it("is MIT OR Apache-2.0 in the package, which ships both texts", () => {
    const manifest: unknown = JSON.parse(text("package.json"));
    expect(manifest).toMatchObject({ license: LICENSE });
    const files =
      typeof manifest === "object" && manifest !== null && "files" in manifest
        ? manifest.files
        : undefined;
    expect(Array.isArray(files) && LICENSE_FILES.every((file) => files.includes(file))).toBe(true);
  });

  it.each(["", SSKR_ENGINE_FOLDER])("has both texts in the folder '%s'", (folder) => {
    const [mit, apache] = LICENSE_FILES.map((file) => text(join(folder, file)));
    expect(mit!.startsWith(`${MIT_TITLE}\n`)).toBe(true);
    expect(apache).toMatch(APACHE_TITLE);
  });

  it.each(NOTICE_SECTIONS)(
    "travels with each executable, first in the notices of $title",
    ({ title, folder }) => {
      const [mit, apache] = LICENSE_FILES.map((file) => text(join(folder, file)));
      expect(sectionOf(executableNotices(), title).startsWith(`${mit}\n${apache}`)).toBe(true);
    },
  );
});
