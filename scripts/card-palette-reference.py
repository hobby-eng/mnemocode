#!/usr/bin/env python3
"""Independent reference of src/export/card-palette.ts and src/export/business-tint.ts.

Written apart from the TypeScript, from the rule as the owner approved it (2026-10-13): candidate
colours every 3 degrees of hue with three saturations and three values, each seen in full and as a
typical pixel of the vivid and the muted business designs, compared in OKLab in whole millionths,
the farthest first. It first reproduces the OKLab of sRGB red that CSS Color 4 publishes, then
prints the first colours of a set, which test/card-sets.test.ts and the self-test of card sets
(src/export/card-sets-self-test.ts) compare with. Public data only; standard library only.

    python3 scripts/card-palette-reference.py [count]
"""

import math
import sys

STEPS = 1_000_000


def js_round(x):
    """Math.round: halves up."""
    return math.floor(x + 0.5)


def linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def oklab(r, g, b):
    r, g, b = linear(r), linear(g), linear(b)
    l = math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    )


def hsv(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    rng = mx - mn
    if rng == 0:
        h = 0
    elif mx == r:
        h = ((g - b) / rng + 6) % 6
    elif mx == g:
        h = (b - r) / rng + 2
    else:
        h = (r - g) / rng + 4
    return h / 6, (0 if mx == 0 else rng / mx), mx


def bytes_of_hsv(h, s, v):
    sector = h * 6
    chroma = v * s
    second = chroma * (1 - abs((sector % 2) - 1))
    lift = v - chroma
    if sector < 1:
        rgb = (chroma, second, 0)
    elif sector < 2:
        rgb = (second, chroma, 0)
    elif sector < 3:
        rgb = (0, chroma, second)
    elif sector < 4:
        rgb = (0, second, chroma)
    elif sector < 5:
        rgb = (second, 0, chroma)
    else:
        rgb = (chroma, 0, second)
    return tuple(js_round((x + lift) * 255) for x in rgb)


TINTS = {
    "vivid": (lambda t: max(0.4, t), 1),
    "muted": (lambda t: max(0.3, min(0.75, t * 0.8)), 0.86),
}


def typical(hexcode, tint):
    rgb = bytes.fromhex(hexcode)
    hue, sat, _ = hsv(*rgb)
    brightness = 0.35 + (1 - 0.35) * (max(rgb) / 255)
    grey = sat < 0.08
    turned = (((hue + hue - hue) % 1) + 1) % 1
    saturation, value = TINTS[tint]
    tinted = 0 if grey else 0.9 * saturation(sat)
    scale = 0.6 if grey else value
    return bytes_of_hsv(turned, tinted, 0.85 * scale * brightness)


def views(hexcode):
    full = tuple(b / 255 for b in bytes.fromhex(hexcode))
    return [oklab(*full)] + [oklab(*(b / 255 for b in typical(hexcode, t))) for t in ("vivid", "muted")]


def distance(a, b):
    return min(js_round(math.sqrt(sum((x - y) * (x - y) for x, y in zip(p, q))) * STEPS) for p, q in zip(a, b))


def palette(count):
    candidates = []
    for degrees in range(0, 360, 3):
        for s in (0.45, 0.72, 0.95):
            for v in (0.5, 0.75, 1):
                rgb = bytes_of_hsv(degrees / 360, s, v)
                hexcode = "".join(f"{js_round(min(1, max(0, b / 255)) * 255):02X}" for b in rgb)
                candidates.append((hexcode, views(hexcode)))
    nearest = [math.inf] * len(candidates)
    order = []
    while len(order) < count:
        if not order:
            chosen = len(candidates) // 2
        else:
            chosen = 0
            for index in range(1, len(candidates)):
                if nearest[index] > nearest[chosen]:
                    chosen = index
        order.append("#" + candidates[chosen][0])
        for index, (_, look) in enumerate(candidates):
            nearest[index] = min(nearest[index], distance(look, candidates[chosen][1]))
    return order


# CSS Color 4 publishes sRGB red as oklab(0.628 0.225 0.126), to three decimals.
red = oklab(1, 0, 0)
assert [round(x, 3) for x in red] == [0.628, 0.225, 0.126], red
count = int(sys.argv[1]) if len(sys.argv) > 1 else 8
print(" ".join(palette(count)))
