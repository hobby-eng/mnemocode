import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { businessFields, PHYSICAL_BUSINESS_STYLES } from "../src/export/business-designs.js";
import { MM } from "../src/export/business-layout.js";
import { fit } from "../src/export/business-render-primitives.js";
import {
  COMMON_ROLES,
  createCardIdentity,
  EMPLOYERS,
  PERSON_NAMES,
  SECTOR_ROLES,
  type CompanySector,
} from "../src/export/card-identities.js";
import { nodeRenderPlatform } from "../src/export/platform-node.js";

const CARD_WIDTH_MM = 90;
const longest = (values: readonly string[]) => [...values].sort((a, b) => b.length - a.length)[0]!;

describe("invented card details", () => {
  it("fit every business design, for every employer with the longest name and role", async () => {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    const font = await document.embedFont(
      readFileSync(new URL("../assets/fonts/DejaVuSans-UI.ttf", import.meta.url)),
    );
    const name = longest(PERSON_NAMES);
    const isSector = (key: string): key is CompanySector => Object.hasOwn(EMPLOYERS, key);
    for (const sector of Object.keys(EMPLOYERS).filter(isSector)) {
      const role = longest([...SECTOR_ROLES[sector], ...COMMON_ROLES]);
      for (const company of EMPLOYERS[sector]) {
        const profile = createCardIdentity(
          nodeRenderPlatform.randomInt,
          { name, company, role },
          sector,
        );
        // The mixed template shows every design, so every employer meets every design.
        for (const style of PHYSICAL_BUSINESS_STYLES)
          for (const field of businessFields(style, profile))
            expect(
              () =>
                fit(
                  font,
                  field.value,
                  field.preferred,
                  field.minimum,
                  CARD_WIDTH_MM * MM * field.width,
                  field.label,
                ),
              `${style}: ${field.label} of ${company}`,
            ).not.toThrow();
      }
    }
  });

  it("end in the reserved example domain and shorten a long company name", () => {
    const identity = createCardIdentity(nodeRenderPlatform.randomInt, {
      company: "Northern Harbour Business Services",
    });
    expect(identity.website).toBe("northernharbour.example");
    expect(identity.email).toBe("contact@northernharbour.example");
    // One long word has no shorter form, so it is cut.
    expect(
      createCardIdentity(nodeRenderPlatform.randomInt, { company: "Abcdefghijklmnopqrstuvwxyz" })
        .website,
    ).toBe("abcdefghijklmnopqr.example");
    // A supplied address is printed as given.
    expect(
      createCardIdentity(nodeRenderPlatform.randomInt, { company: "Any", website: "any.org" })
        .website,
    ).toBe("any.org");
  });
});
