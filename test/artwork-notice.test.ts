// The images of the card designs travel with their notice (AUD-037-DOC017): assets/images/NOTICE
// says where they come from and lists each of them with its SHA-256, and each executable carries
// that notice among the notices of the bundled assets.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSETS_FOLDER } from "../src/bundled-file-paths.js";
import { executableNotices } from "./helpers/executable-notices.js";

/** The folder of the images of the card designs, and their notice in it. */
const IMAGES = join(ASSETS_FOLDER, "images");
const NOTICE = "NOTICE";
/** The line before the list of the notice. */
const LIST_START = "SHA-256 of each image:\n";
/** A line of the list, as sha256sum writes it after two spaces: the SHA-256 and the file name. */
const LISTED = /^ {2}(?<sha256>[0-9a-f]{64}) {2}(?<name>\S+)$/u;

/** The text of the notice. */
function notice(): string {
  return readFileSync(join(IMAGES, NOTICE), "utf8");
}

/** Each image of the notice's list with its SHA-256, in the order listed. */
function listedImages(): { readonly name: string; readonly sha256: string }[] {
  const text = notice();
  expect(text).toContain(LIST_START);
  const list = text.slice(text.indexOf(LIST_START) + LIST_START.length).trimEnd();
  return list.split("\n").map((line) => {
    const listed = LISTED.exec(line)?.groups;
    expect(listed, line).toBeDefined();
    return { name: listed!.name!, sha256: listed!.sha256! };
  });
}

describe("the notice of the card artwork", () => {
  it("lists every image of the card designs once, with its SHA-256, and no other file", () => {
    const listed = listedImages();
    const images = readdirSync(IMAGES).filter((name) => name !== NOTICE);
    expect(listed.map((image) => image.name).sort()).toEqual(images.sort());
    for (const { name, sha256 } of listed)
      expect(
        createHash("sha256")
          .update(readFileSync(join(IMAGES, name)))
          .digest("hex"),
        name,
      ).toBe(sha256);
  });

  it("travels with each executable, among the notices of the bundled assets", () => {
    const notices = executableNotices();
    const heading = notices.indexOf("Fonts, map data and card artwork\n");
    expect(heading).toBeGreaterThan(-1);
    expect(notices.slice(heading)).toContain(notice());
  });
});
