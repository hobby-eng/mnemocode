import { expect, it } from "vitest";
import * as colors from "../src/export/color-math.js";

it("exposes the shared IEC sRGB transfer with independent cutoff and representative answers", () => {
  expect(colors).toHaveProperty("linearChannel");
  const linear: unknown = Reflect.get(colors, "linearChannel");
  if (typeof linear !== "function") throw new Error("The shared channel transfer is missing.");
  // Python Decimal at 50 digits, IEC 61966-2-1's piecewise expression, rounded once to binary64.
  for (const [channel, expected] of [
    [0, 0],
    [0.04045, 0.0031308049535603713],
    [0.04046, 0.00313159455268899],
    [0.5, 0.21404114048223244],
    [1, 1],
  ] as const) {
    const actual: unknown = Reflect.apply(linear, undefined, [channel]);
    if (typeof actual !== "number") throw new Error("A channel transfer must return a number.");
    expect(actual).toBeCloseTo(expected, 14);
  }
});
