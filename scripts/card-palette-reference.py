#!/usr/bin/env python3
"""Independent reference of the card palette and the business tints.

It is written apart from src/export/card-palette.ts and
src/export/business-tint.ts, from the rule as the owner approved it
(2026-10-13): candidate colours every 3 degrees of hue with three
saturations and three values, each seen in full and as a typical pixel
of the vivid and the muted business designs, compared in OKLab in whole
millionths, the farthest first. It first reproduces the OKLab of sRGB
red that CSS Color 4 publishes, then prints the first colours of a set,
which test/card-sets.test.ts and the self-test of card sets
(src/export/card-sets-self-test.ts) compare with. Public data only;
standard library only.

    python3 scripts/card-palette-reference.py [count]

The count is how many colours to print: 8 when it is left out, and at
most one for each candidate.
"""

import math
import sys

STEPS = 1_000_000
# The candidates of the rule: a hue every 3 degrees, each with three
# saturations and three values.
HUE_DEGREES = range(0, 360, 3)
SATURATIONS = (0.45, 0.72, 0.95)
VALUES = (0.5, 0.75, 1)
# The most colours a palette has, one for each candidate:
# src/export/card-palette.ts refuses more
# (cards-print-codes-at-most-colours), and here every colour after them
# would repeat the first.
CANDIDATE_COUNT = len(HUE_DEGREES) * len(SATURATIONS) * len(VALUES)
# The colours printed when no count is given.
DEFAULT_COUNT = 8
# The largest value of a colour channel's byte.
CHANNEL_MAX = 255
# The numbers of the rule as the owner approved them (2026-10-13), with
# which the approved artwork was drawn. How strongly the coloured parts
# of a design take a reference's colour: the factor of their
# saturation, from the reference's saturation, and of their value; the
# muted designs keep a quieter, darker tint.
VIVID_MIN_SATURATION, VIVID_VALUE = 0.4, 1
MUTED_MIN_SATURATION, MUTED_MAX_SATURATION = 0.3, 0.75
MUTED_SATURATION_FACTOR, MUTED_VALUE = 0.8, 0.86
# The share of the artwork's own brightness that every reference keeps;
# the rest follows the reference's brightest channel.
BRIGHTNESS_FLOOR = 0.35
# Below this saturation a reference counts as grey: its artwork turns
# grey, with this factor of its value.
GREY_SATURATION = 0.08
GREY_VALUE = 0.6
# The saturation and value of a typical coloured pixel of the
# photographs, measured on the approved artwork.
TYPICAL_SATURATION, TYPICAL_VALUE = 0.9, 0.85


def js_round(x):
    """Math.round: halves up."""
    return math.floor(x + 0.5)


def linear(c):
    """The linear light of an sRGB channel `c` from 0 to 1: the sRGB
    transfer function undone.
    """
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def oklab(r, g, b):
    """The OKLab lightness and a and b axes of the sRGB colour whose
    channels `r`, `g` and `b` run from 0 to 1, by Ottosson's matrices.
    """
    r, g, b = linear(r), linear(g), linear(b)
    # The long, medium and short cone responses, named l_, m_ and s_
    # as in Ottosson's OKLab code.
    l_ = math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m_ = math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s_ = math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (
        0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
    )


def hsv(r, g, b):
    """The hue in turns, the saturation from 0 to 1 and the value, in
    the unit of the channels `r`, `g` and `b`, of a colour.
    """
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
    """The red, green and blue bytes of the colour of hue `h` in turns
    and saturation `s` and value `v` from 0 to 1, rounded as
    Math.round rounds.
    """
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
    return tuple(js_round((x + lift) * CHANNEL_MAX) for x in rgb)


TINTS = {
    "vivid": (lambda t: max(VIVID_MIN_SATURATION, t), VIVID_VALUE),
    "muted": (
        lambda t: max(
            MUTED_MIN_SATURATION,
            min(MUTED_MAX_SATURATION, t * MUTED_SATURATION_FACTOR),
        ),
        MUTED_VALUE,
    ),
}


def typical(hexcode, tint):
    """The bytes of a typical coloured pixel of a design of `tint`,
    "vivid" or "muted", under the reference colour `hexcode`, six hex
    digits.
    """
    rgb = bytes.fromhex(hexcode)
    hue, sat, _ = hsv(*rgb)
    peak = max(rgb) / CHANNEL_MAX
    brightness = BRIGHTNESS_FLOOR + (1 - BRIGHTNESS_FLOOR) * peak
    grey = sat < GREY_SATURATION
    turned = (((hue + hue - hue) % 1) + 1) % 1
    saturation, value = TINTS[tint]
    tinted = 0 if grey else TYPICAL_SATURATION * saturation(sat)
    scale = GREY_VALUE if grey else value
    return bytes_of_hsv(turned, tinted, TYPICAL_VALUE * scale * brightness)


def views(hexcode):
    """The OKLab of the colour `hexcode` in each view of it: in full,
    then as a typical pixel of the vivid and of the muted designs.
    """
    full = tuple(b / CHANNEL_MAX for b in bytes.fromhex(hexcode))
    typicals = (typical(hexcode, tint) for tint in ("vivid", "muted"))
    seen = [oklab(*(b / CHANNEL_MAX for b in rgb)) for rgb in typicals]
    return [oklab(*full)] + seen


def distance(a, b):
    """How far apart the views `a` and `b` of two colours are: the
    least OKLab distance of a view to the same view, in whole
    millionths (STEPS).
    """
    return min(
        js_round(
            math.sqrt(sum((x - y) * (x - y) for x, y in zip(p, q))) * STEPS
        )
        for p, q in zip(a, b)
    )


def palette(count):
    """The first `count` colours of a set, as #RRGGBB: the middle
    candidate, then each time the candidate farthest from every colour
    chosen, the first of equals.
    """
    candidates = []
    for degrees in HUE_DEGREES:
        for s in SATURATIONS:
            for v in VALUES:
                rgb = bytes_of_hsv(degrees / 360, s, v)
                channels = (min(1, max(0, b / CHANNEL_MAX)) for b in rgb)
                hexcode = "".join(
                    f"{js_round(c * CHANNEL_MAX):02X}" for c in channels
                )
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
        chosen_look = candidates[chosen][1]
        for index, (_, look) in enumerate(candidates):
            nearest[index] = min(nearest[index], distance(look, chosen_look))
    return order


def count_of(arguments):
    """How many colours `arguments` ask for; DEFAULT_COUNT for none.

    Anything but one whole number from 1 to CANDIDATE_COUNT ends the
    script with one line that names the limit, before any colour is
    worked out.
    """
    if not arguments:
        return DEFAULT_COUNT
    try:
        count = int(arguments[0]) if len(arguments) == 1 else 0
    except ValueError:
        count = 0
    if not 1 <= count <= CANDIDATE_COUNT:
        sys.exit(
            "Give one whole number of colours, from 1 to "
            f"{CANDIDATE_COUNT}."
        )
    return count


# CSS Color 4 publishes sRGB red as oklab(0.628 0.225 0.126), to three
# decimals.
red = oklab(1, 0, 0)
assert [round(x, 3) for x in red] == [0.628, 0.225, 0.126], red
print(" ".join(palette(count_of(sys.argv[1:]))))
