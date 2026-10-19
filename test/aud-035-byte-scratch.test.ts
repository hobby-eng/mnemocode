import { describe, expect, it, vi } from "vitest";
import { rgbBytes, rgbChannels } from "../src/export/color-math.js";
import { validCharacters } from "../src/cli/utf8.js";

describe("private conversion byte scratch lifetime (AUD-029-SEC001)", () => {
  it("keeps RGB results while retiring the actual intermediate byte allocations", () => {
    const convert = vi.spyOn(Uint8Array, "from");
    try {
      expect(rgbBytes("#123456")).toEqual([0x12, 0x34, 0x56]);
      expect(rgbChannels("ABCDEF")).toEqual([0xab / 255, 0xcd / 255, 0xef / 255]);
      expect(convert.mock.results).toHaveLength(2);
      for (const row of convert.mock.results) {
        expect(row.type).toBe("return");
        if (row.type === "return") expect([...row.value]).toEqual([0, 0, 0]);
      }
    } finally {
      for (const row of convert.mock.results) if (row.type === "return") row.value.fill(0);
      convert.mockRestore();
    }
  });

  it("retires decoded bytes when an incomplete color cannot supply all channels", () => {
    const convert = vi.spyOn(Uint8Array, "from");
    try {
      expect(() => rgbBytes("#12")).toThrow(
        expect.objectContaining({ code: "core.defined.missing-value" }),
      );
      expect(convert.mock.results).toHaveLength(1);
      const result = convert.mock.results[0]!;
      expect(result.type).toBe("return");
      if (result.type === "return") expect([...result.value]).toEqual([0]);
    } finally {
      for (const row of convert.mock.results) if (row.type === "return") row.value.fill(0);
      convert.mockRestore();
    }
  });

  it.each([
    { bytes: [0xe6, 0xb8, 0xac], accepted: true },
    { bytes: [0xed, 0xa0, 0x80], accepted: false },
  ])(
    "retires validation bytes while UTF-8 acceptance is $accepted",
    async ({ bytes, accepted }) => {
      const convert = vi.spyOn(Uint8Array, "from");
      try {
        let place = 0;
        const reader = validCharacters(async () => bytes[place++]);
        const output: number[] = [];
        for (let byte = await reader.next(); byte !== undefined; byte = await reader.next())
          output.push(byte);
        expect(output).toEqual(accepted ? bytes : []);
        expect(reader.leftOut()).toBe(!accepted);
        expect(convert.mock.results).toHaveLength(1);
        const result = convert.mock.results[0]!;
        expect(result.type).toBe("return");
        if (result.type === "return") expect([...result.value]).toEqual([0, 0, 0]);
      } finally {
        for (const row of convert.mock.results) if (row.type === "return") row.value.fill(0);
        convert.mockRestore();
      }
    },
  );
});
