import { describe, expect, it } from "vitest";
import { resolveSskrLayout, type SskrCardLayout } from "../src/export/sskr-content.js";

// The layouts of share cards and the page sizes each one takes (sskr-content.ts SSKR_LAYOUT_RULES).

describe("the layout of share cards", () => {
  it("takes the layout that the page size gives when none is asked for", () => {
    expect(resolveSskrLayout(undefined, undefined)).toBe("collection");
    expect(resolveSskrLayout(undefined, "a5")).toBe("collection");
    expect(resolveSskrLayout(undefined, "business")).toBe("individual");
  });

  it("gives QR cards in every size, that of sheets and that of separate cards", () => {
    for (const size of ["a6", "a5", "a4", "business", undefined] as const)
      expect(resolveSskrLayout("qr", size)).toBe("qr");
  });

  it("refuses a collection sheet of the business size and separate cards of a sheet size", () => {
    expect(() => resolveSskrLayout("collection", "business")).toThrow(
      expect.objectContaining({
        code: "export.sskr-content.business-page-size-gives-separate-cards-choose-size",
      }),
    );
    expect(() => resolveSskrLayout("individual", "a4")).toThrow(
      expect.objectContaining({
        code: "export.card-settings.separate-cards-business-size-choose-business-size-leave",
      }),
    );
    expect(resolveSskrLayout("collection", "a4")).toBe("collection");
    expect(resolveSskrLayout("individual", "business")).toBe("individual");
  });

  it("refuses a layout of none that a JavaScript host passes", () => {
    // A layout of no type that the parameter allows, fed on purpose as a JavaScript host could.
    expect(() => resolveSskrLayout("folded" as SskrCardLayout, "a6")).toThrow(
      expect.objectContaining({ code: "export.sskr-content.card-layout-one" }),
    );
  });
});
