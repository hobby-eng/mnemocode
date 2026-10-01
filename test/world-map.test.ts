import { describe, expect, it } from "vitest";
import { graticule, robinson, WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH } from "../src/export/world-map.js";
import { WORLD_MAP_LAND } from "../src/export/world-map-data.js";

describe("world map behind a collection sheet", () => {
  it("projects the equator and the edges of the world onto the map box", () => {
    expect(robinson(0, 0)).toEqual({ x: WORLD_MAP_WIDTH / 2, y: WORLD_MAP_HEIGHT / 2 });
    expect(robinson(180, 0).x).toBeCloseTo(WORLD_MAP_WIDTH);
    expect(robinson(-180, 0).x).toBeCloseTo(0);
    expect(robinson(0, 90).y).toBeCloseTo(0);
    expect(robinson(0, -90).y).toBeCloseTo(WORLD_MAP_HEIGHT);
    // A parallel near the pole is about half as long as the equator.
    expect(robinson(180, 90).x - robinson(-180, 90).x).toBeCloseTo(WORLD_MAP_WIDTH * 0.5322);
    // Between two table rows the values are interpolated.
    expect(robinson(0, 47.5).y).toBeLessThan(robinson(0, 45).y);
    expect(robinson(0, 47.5).y).toBeGreaterThan(robinson(0, 50).y);
  });

  it("keeps every generated land shape closed and inside the map box", () => {
    expect(WORLD_MAP_LAND.length).toBeGreaterThan(100);
    for (const path of WORLD_MAP_LAND) {
      expect(path).toMatch(/^M\d+ \d+(?:L\d+ \d+){3,}Z$/u);
      for (const [, x, y] of path.matchAll(/(\d+) (\d+)/gu)) {
        expect(Number(x)).toBeLessThanOrEqual(WORLD_MAP_WIDTH);
        expect(Number(y)).toBeLessThanOrEqual(WORLD_MAP_HEIGHT);
      }
    }
  });

  it("draws one line for every meridian and parallel", () => {
    // 13 meridians and 7 parallels for a step of 30 degrees.
    expect(graticule(30)).toHaveLength(13 + 7);
  });
});
