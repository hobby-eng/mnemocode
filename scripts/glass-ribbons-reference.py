#!/usr/bin/env python3
"""Independent reference of src/export/glass-ribbons.ts for the photographed glass card.

It applies the same rules with numpy and colorsys and prints the SHA-256 of the ribbon map (int8,
row by row, -1 for no ribbon) followed by the saturation and the value of every pixel (float64,
little-endian, row by row), and the pixels of each ribbon: the known answer that
test/glass-ribbons.test.ts compares with. Public bundled artwork only.

    python3 scripts/glass-ribbons-reference.py [ribbons.npy]
"""

import colorsys
import hashlib
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

PHOTOGRAPH = Path(__file__).resolve().parents[1] / "assets/images/business-glass-4in1.png"
SEARCH_TOP, SEARCH_BOTTOM = 0.22, 0.69
RIBBON_GAP, GOLD_GAP, MIN_RIBBON_ROWS = 6, 3, 12
LINE_OFFSETS = [-1, -1, 0, 1, 1]
SEED_SEARCH_ROWS, TRACE_SEARCH_ROWS, SLOPE_COLUMNS = 3, 2, 8
RIM_VALUE, RIM_SATURATION = 0.97, 0.04
CONTINUE_COLUMNS = 10
HALF_LINE_ROWS = 0.5
BEYOND_RIM_GOLD_ROWS = 8
CORE_ROWS, SMOOTH_COLUMNS, FADE_COLUMNS = 2, 7, 55
GOLD_ABOVE, GOLD_BELOW = 0, 3


def median(values):
    ordered = sorted(v for v in values if not math.isnan(v))
    if not ordered:
        return math.nan
    half = len(ordered) // 2
    return ordered[half] if len(ordered) % 2 else (ordered[half - 1] + ordered[half]) / 2


def plain_sum(values):
    # Added one after the other, as TypeScript does; Python's sum() compensates since 3.12.
    total = 0.0
    for value in values:
        total += value
    return total


def line_through(xs, ys):
    mean_x, mean_y = plain_sum(xs) / len(xs), plain_sum(ys) / len(ys)
    covariance = variance = 0.0
    for x, y in zip(xs, ys):
        covariance += (x - mean_x) * (y - mean_y)
        variance += (x - mean_x) ** 2
    slope = covariance / variance
    return slope, mean_y - slope * mean_x


def main() -> None:
    rgb = np.asarray(Image.open(PHOTOGRAPH).convert("RGB")).astype(float) / 255
    height, width = rgb.shape[:2]
    channels = np.array(
        [[colorsys.rgb_to_hsv(*rgb[y, x]) for x in range(width)] for y in range(height)]
    )
    hue, saturation, value = channels[..., 0], channels[..., 1], channels[..., 2]
    teal = (saturation > 0.22) & (hue > 0.43) & (hue < 0.56)
    blue = (saturation > 0.15) & (hue >= 0.56) & (hue < 0.68)
    strong_gold = (saturation > 0.16) & (hue > 0.04) & (hue < 0.19)
    highlight = (saturation < 0.07) | (value > 0.985)
    searched = [y for y in range(int(height * SEARCH_TOP), height) if y < height * SEARCH_BOTTOM]

    # The boundaries of the middle column, where the photograph shows every ribbon clearly.
    def longest(rows):
        runs = []
        for y in rows:
            if runs and y - runs[-1][1] <= RIBBON_GAP:
                runs[-1][1] = y
            else:
                runs.append([y, y])
        return max(runs, key=lambda run: run[1] - run[0])

    def gold_edge(x, start, step):
        y, last, gap = start, None, 0
        while 0 <= y < height and gap <= GOLD_GAP:
            if last is not None and highlight[y, x]:
                break
            if strong_gold[y, x]:
                last, gap = y, 0
            else:
                gap += 1
            y += step
        return last

    seed = width // 2
    t = longest([y for y in searched if teal[y, seed]])
    b = longest([y for y in searched if blue[y, seed]])
    assert t[1] - t[0] >= MIN_RIBBON_ROWS and b[1] - b[0] >= MIN_RIBBON_ROWS
    gold_top, gold_bottom = gold_edge(seed, t[0] - 1, -1), gold_edge(seed, b[1] + 1, 1)
    boundaries = [gold_top, t[0], (t[1] + b[0]) / 2, b[1], gold_bottom]

    # The white lines, traced from the middle column to the white rims.
    own = value * (1 - saturation)
    whiteness = own.copy()
    whiteness[:, 1:-1] = (own[:, :-2] + own[:, 1:-1] + own[:, 2:]) / 3
    rim = [
        median(value[searched, x]) > RIM_VALUE and median(saturation[searched, x]) < RIM_SATURATION
        for x in range(width)
    ]

    def whitest_row(x, centre, reach):
        first = math.floor(centre + 0.5) - reach
        best = first + int(np.argmax(whiteness[first:first + 2 * reach + 1, x]))
        above, at, below = whiteness[best - 1, x], whiteness[best, x], whiteness[best + 1, x]
        curvature = above - 2 * at + below
        return best + 0.5 * (above - below) / curvature if curvature < 0 else float(best)

    lines = np.full((5, width), math.nan)
    for line, (boundary, offset) in enumerate(zip(boundaries, LINE_OFFSETS)):
        lines[line, seed] = whitest_row(seed, boundary + offset, SEED_SEARCH_ROWS)
        for step in (1, -1):
            x, travelled = seed + step, 1
            while 0 <= x < width and not rim[x]:
                back = min(SLOPE_COLUMNS, travelled)
                last, earliest = lines[line, x - step], lines[line, x - step * back]
                slope = (last - earliest) / (back - 1) if back > 1 else 0.0
                lines[line, x] = whitest_row(x, last + slope, TRACE_SEARCH_ROWS)
                x, travelled = x + step, travelled + 1
    traced = np.flatnonzero(~np.isnan(lines[0]))
    inner_left, inner_right = int(traced.min()), int(traced.max())
    for line in lines:
        beyond = [
            (inner_left, range(inner_left)),
            (inner_right - CONTINUE_COLUMNS + 1, range(inner_right + 1, width)),
        ]
        for start, columns in beyond:
            xs = list(range(start, start + CONTINUE_COLUMNS))
            slope, intercept = line_through([float(x) for x in xs], [float(line[x]) for x in xs])
            for x in columns:
                line[x] = slope * x + intercept

    # Every pixel between the outer lines belongs to the ribbon between the lines around it.
    ribbons = np.full((height, width), -1, np.int8)
    distance = np.full((height, width), math.inf)
    for x in range(width):
        if rim[x]:
            continue
        top, bottom = lines[0, x] - HALF_LINE_ROWS, lines[4, x] + HALF_LINE_ROWS
        for y in range(height):
            if top <= y <= bottom:
                ribbons[y, x] = sum(int(y > lines[line, x]) for line in (1, 2, 3))
            distance[y, x] = min(abs(y - lines[line, x]) for line in range(5))
        if inner_left <= x <= inner_right:
            continue
        # Beyond a rim the glass edge shifts the gold ribbons past the lines carried on.
        outward = [(math.ceil(top) - 1, -1, GOLD_ABOVE), (math.floor(bottom) + 1, 1, GOLD_BELOW)]
        for start, step, ribbon in outward:
            y, rows = start, 0
            while 0 <= y < height and rows < BEYOND_RIM_GOLD_ROWS:
                if not strong_gold[y, x] or highlight[y, x]:
                    break
                ribbons[y, x] = ribbon
                y, rows = y + step, rows + 1

    # The frost fades the ribbons towards the rims; their tone there is brought back to the tone a
    # little further in.
    left, right = inner_left + FADE_COLUMNS, inner_right - FADE_COLUMNS
    fade_saturation = np.zeros((4, width))
    fade_value = np.zeros((4, width))
    for ribbon in range(4):
        core = (ribbons == ribbon) & (distance >= CORE_ROWS)
        tone = {}
        for name, channel in [("s", saturation), ("v", value)]:
            raw = [median(channel[core[:, x], x]) for x in range(width)]
            tone[name] = {}
            for x in range(inner_left, inner_right + 1):
                first = max(inner_left, x - SMOOTH_COLUMNS)
                last = min(inner_right, x + SMOOTH_COLUMNS)
                near = raw[first : last + 1]
                tone[name][x] = median(near)
        for x in range(width):
            if x < left:
                reference = left
            elif x > right:
                reference = right
            else:
                continue
            here = min(max(x, inner_left), inner_right)
            lost_saturation = tone["s"][reference] - tone["s"][here]
            gained_value = tone["v"][here] - tone["v"][reference]
            fade_saturation[ribbon, x] = lost_saturation if lost_saturation > 0 else 0.0
            fade_value[ribbon, x] = gained_value if gained_value > 0 else 0.0

    corrected_saturation, corrected_value = saturation.copy(), value.copy()
    for y in range(height):
        for x in range(width):
            ribbon = ribbons[y, x]
            if ribbon < 0:
                continue
            weight = min(1.0, max(0.0, distance[y, x] - HALF_LINE_ROWS))
            s = min(1.0, saturation[y, x] + weight * fade_saturation[ribbon, x])
            v = max(0.0, value[y, x] - weight * fade_value[ribbon, x])
            if s < 0.07 or v > 0.985:
                ribbons[y, x] = -1
                continue
            corrected_saturation[y, x], corrected_value[y, x] = s, v

    if len(sys.argv) > 1:
        np.save(sys.argv[1], ribbons)
        tone = np.stack([corrected_saturation, corrected_value])
        np.save(sys.argv[1].replace(".npy", "-tone.npy"), tone)
    digest = hashlib.sha256()
    for array in (ribbons, corrected_saturation, corrected_value):
        digest.update(array.astype(array.dtype.newbyteorder("<")).tobytes())
    print(digest.hexdigest())
    print([int((ribbons == r).sum()) for r in range(4)])


if __name__ == "__main__":
    main()
