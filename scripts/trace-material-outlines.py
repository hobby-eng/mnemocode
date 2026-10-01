"""Traces the outline of the object in the finish photographs of the material templates.

    python3 scripts/trace-material-outlines.py [--preview <folder>]

The tint of a material sample (src/export/material-cards.ts) is clipped to the object, so that the
backdrop, the shadow and the screw of the photograph keep their own colour. Every finish of a style
shows the same kind of object, a cabinet front, a hood, a switch plate or a box corner,
photographed in another colour; so one outline per style is traced from the finish where the
object stands out best, and every finish gets the scale and shift that lay that outline on its own
object.

In the reference finish the object is told from its backdrop by one plain rule per style (darker
than the light card, bluer than it, more colourful than the dark floor, or inside a sharp rim),
then cleaned: small gaps are closed, thin fringes opened, small holes filled. The outline runs
INSET pixels inside the object's edge. The placement on another finish is the scale and shift that
put the object's edge on the strongest edges of that photograph, or, where the rule finds the
object in every finish, on the object found there; the search takes about a minute.

The script prints, per style, the outline as rings of x, y pairs in fractions of the crop (the
first ring is the object, any further ring a hole in it, such as a screw), and the placement of
each finish as scale, x shift and y shift, ready to paste into src/export/material-artwork.ts.
With --preview it also writes every crop with its outline drawn, to check the result by eye. It
needs Python 3 with Pillow and NumPy.
"""

import re
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src/export/material-artwork.ts"
# Blur radius in pixels that smooths brushing and paper texture before any rule is applied.
BLUR = 1.2


def inside_rim(pixels):
    """Everything that the backdrop does not reach from the border of the crop: the backdrop takes
    in each neighbouring pixel whose colour differs from it by less than GROW_STEP per channel, so
    it crosses the soft gradient of a shadow but stops at the sharp rim of an object."""
    height, width, _ = pixels.shape
    backdrop = np.zeros((height, width), bool)
    backdrop[[0, -1], :] = backdrop[:, [0, -1]] = True
    queue = deque(zip(*np.nonzero(backdrop)))
    while queue:
        y, x = queue.popleft()
        for dy, dx in NEIGHBOURS:
            ny, nx = y + dy, x + dx
            if 0 <= ny < height and 0 <= nx < width and not backdrop[ny, nx]:
                if np.abs(pixels[ny, nx] - pixels[y, x]).max() < GROW_STEP:
                    backdrop[ny, nx] = True
                    queue.append((ny, nx))
    return ~backdrop


def lightness(pixels):
    return pixels @ np.array([0.299, 0.587, 0.114])


def colourfulness(pixels):
    return pixels.max(axis=2) - pixels.min(axis=2)


class Style:
    """How the object is found in the reference finish of a style."""

    def __init__(self, reference, rule, closing, opening, keep_holes, fit_by_mask=False):
        # The finish whose object stands out best from its backdrop.
        self.reference = reference
        # True for the pixels of the object, from the blurred RGB pixels.
        self.rule = rule
        # Radius in pixels of the closing that joins speckles and bright bevels to the object.
        self.closing = closing
        # Radius in pixels of the opening that removes thin fringes of shadow or floor.
        self.opening = opening
        # Whether holes in the object, such as a screw, stay out of the tint.
        self.keep_holes = keep_holes
        # Whether the rule finds the object in every finish, so that the outline is laid on the
        # object found there (mask_fit) rather than on the strongest edges (edge_fit).
        self.fit_by_mask = fit_by_mask


# The limits were read from the photographs: the black hood stays below 95 out of 255 while its
# card and the shadow on it stay above; the blue plate has more blue than red by more than 6, while
# the warm card and its shadow have more red; the teal box is more colourful than 10, while the
# black floor, the frame around it and the steel screw are grey. Every kitchen front has a sharp
# rim, bevel included, inside a soft shadow. The closing joins the bright facets of the hood and
# the bevels of the plate and the box to the object.
STYLES = {
    "kitchen": Style("Graphite matte", inside_rim, 8, 3, False, fit_by_mask=True),
    "vehicle": Style("Satin black", lambda pixels: lightness(pixels) < 95, 8, 3, False),
    "switch": Style("Ocean blue", lambda pixels: pixels[..., 2] - pixels[..., 0] > 6, 8, 4, False),
    "enclosure": Style("Petrol teal", lambda pixels: colourfulness(pixels) > 10, 8, 6, True),
}
# Largest colour step, per channel out of 255, between neighbouring backdrop pixels in inside_rim.
GROW_STEP = 6
# A kept hole smaller than this share of the crop is a speck, not a part such as a screw.
MIN_HOLE = 0.001
# The outline lies this many pixels inside the object's edge, so that the tint never reaches
# the backdrop where a photograph's edge is soft.
INSET = 2
# Largest distance in pixels between the outline and the traced edge it simplifies.
SIMPLIFY = 1.0
# Largest shift in pixels, and the scales, searched when laying the outline on another finish; the
# objects of one photograph differ in size by up to about 2%. A mask fit compares bands this many
# pixels inside and outside the outline.
MAX_SHIFT = 24
SCALES = np.arange(0.95, 1.0501, 0.005)
BAND = 2
NEIGHBOURS = ((1, 0), (-1, 0), (0, 1), (0, -1))


def finishes(style):
    text = SOURCE.read_text()
    block = text[text.index(f"  {style}: {{") :]
    block = block[: block.index("\n  },")]
    # The arguments may be wrapped onto separate lines by the formatter.
    pattern = r'finish\(\s*"([^"]+)",\s*"[0-9A-F]{6}"' + r",\s*(\d+)" * 6
    for name, *numbers in re.findall(pattern, block):
        yield name, [int(n) for n in numbers]


def crop_of(image, numbers):
    x, y, w, h, source_width, source_height = numbers
    sx, sy = image.width / source_width, image.height / source_height
    return image.crop((round(x * sx), round(y * sy), round((x + w) * sx), round((y + h) * sy)))


def erode(mask, radius):
    """Shrinks the mask by `radius` pixels; beyond the crop is background."""
    result = np.pad(mask, 1)
    for _ in range(radius):
        shrunk = result.copy()
        shrunk[1:] &= result[:-1]
        shrunk[:-1] &= result[1:]
        shrunk[:, 1:] &= result[:, :-1]
        shrunk[:, :-1] &= result[:, 1:]
        result = shrunk
    return result[1:-1, 1:-1]


def dilate(mask, radius):
    """Grows the mask by `radius` pixels."""
    result = mask.copy()
    for _ in range(radius):
        grown = result.copy()
        grown[1:] |= result[:-1]
        grown[:-1] |= result[1:]
        grown[:, 1:] |= result[:, :-1]
        grown[:, :-1] |= result[:, 1:]
        result = grown
    return result


def closing(mask, radius):
    """Fills gaps narrower than twice `radius`. It works on a frame of background around the crop,
    so that a gap between the object and the edge of the crop stays open."""
    framed = np.pad(mask, radius + 1)
    return erode(dilate(framed, radius), radius)[radius + 1 : -radius - 1, radius + 1 : -radius - 1]


def opening(mask, radius):
    """Removes parts narrower than twice `radius`. An object that runs off the crop keeps its
    edge there."""
    framed = np.pad(mask, radius + 1, mode="edge")
    return dilate(erode(framed, radius), radius)[radius + 1 : -radius - 1, radius + 1 : -radius - 1]


def components(mask):
    """The 4-connected regions of the mask, largest first, each as a boolean mask."""
    height, width = mask.shape
    label = np.zeros(mask.shape, int)
    regions = []
    for start in zip(*np.nonzero(mask)):
        if label[start]:
            continue
        regions.append([])
        label[start] = len(regions)
        queue = deque([start])
        while queue:
            y, x = queue.popleft()
            regions[-1].append((y, x))
            for dy, dx in NEIGHBOURS:
                ny, nx = y + dy, x + dx
                if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not label[ny, nx]:
                    label[ny, nx] = len(regions)
                    queue.append((ny, nx))
    regions.sort(key=len, reverse=True)
    return [label == label[region[0]] for region in regions]


def holes(mask):
    """The parts of the background that do not touch the border of the crop."""
    border = np.zeros(mask.shape, bool)
    border[[0, -1], :] = border[:, [0, -1]] = True
    return [region for region in components(~mask) if not (region & border).any()]


def object_mask(crop, style):
    """The object without its holes, and the holes that stay out of the tint."""
    pixels = np.asarray(crop.filter(ImageFilter.GaussianBlur(BLUR)), dtype=float)
    found = style.rule(pixels)
    mask = components(opening(closing(found, style.closing), style.opening))[0]
    for hole in holes(mask):
        mask |= hole
    if not style.keep_holes:
        return mask, []
    # Holes are looked for in the object as found, before the closing has shrunk them.
    return mask, [hole for hole in holes(found) if hole.sum() >= MIN_HOLE * found.size]


def trace(mask):
    """The boundary pixels of a mask's one region in clockwise order (Moore neighbour tracing)."""
    padded = np.pad(mask, 1)
    # Clockwise from west, in image coordinates where y grows downwards.
    around = [(0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1)]
    start = tuple(np.argwhere(padded)[0])
    boundary = [start]
    current, came_from = start, 0
    while True:
        for turn in range(8):
            direction = (came_from + turn) % 8
            dy, dx = around[direction]
            candidate = (current[0] + dy, current[1] + dx)
            if padded[candidate]:
                break
        # The search in the next pixel starts just after the neighbour it came from.
        came_from = (direction + 5) % 8
        current = candidate
        if current == start:
            break
        boundary.append(current)
    return [(x - 1, y - 1) for y, x in boundary]


def simplify(points, tolerance):
    """Ramer-Douglas-Peucker on a closed outline, split at its two farthest points."""

    def distance(point, start, end):
        span_x, span_y = end[0] - start[0], end[1] - start[1]
        cross = span_x * (point[1] - start[1]) - span_y * (point[0] - start[0])
        return abs(cross) / (np.hypot(span_x, span_y) or 1.0)

    def open_line(line):
        if len(line) < 3:
            return line
        distances = [distance(point, line[0], line[-1]) for point in line]
        index = int(np.argmax(distances))
        if distances[index] <= tolerance:
            return [line[0], line[-1]]
        return open_line(line[: index + 1])[:-1] + open_line(line[index:])

    far = max(range(len(points)), key=lambda i: np.hypot(*np.subtract(points[i], points[0])))
    first = open_line(points[: far + 1])
    second = open_line(points[far:] + [points[0]])
    return first[:-1] + second[:-1]


def rings(mask, kept_holes):
    """The simplified outline of the object, then of each hole kept out of it."""
    inner = components(erode(mask, INSET))[0]
    regions = [inner] + [dilate(hole, INSET) & mask for hole in kept_holes]
    return [simplify(trace(region), SIMPLIFY) for region in regions]


def edges(crop):
    gray = np.asarray(crop.convert("L").filter(ImageFilter.GaussianBlur(BLUR)), dtype=float)
    gy, gx = np.gradient(gray)
    return np.hypot(gx, gy)


def placements():
    """Every scale and shift searched, as (scale, dx, dy)."""
    shifts = range(-MAX_SHIFT, MAX_SHIFT + 1)
    return ((scale, dx, dy) for scale in SCALES for dy in shifts for dx in shifts)


def sample(image, points, centre, scale, dx, dy):
    """The values of `image` at the points, scaled about the centre and shifted."""
    height, width = image.shape[:2]
    moved = (points - centre) * scale + centre
    xs = np.clip(np.rint(moved[:, 0] + dx).astype(int), 0, width - 1)
    ys = np.clip(np.rint(moved[:, 1] + dy).astype(int), 0, height - 1)
    return image[ys, xs]


def edge_fit(mask, crop):
    """The scale about the outline's centre and the shift that lay the object's boundary on the
    strongest edges of a photograph, as (scale, dx, dy) in pixels, and the centre."""
    boundary = np.array(trace(mask), dtype=float)
    centre = boundary.mean(axis=0)
    strength = edges(crop)
    score = lambda fit: sample(strength, boundary, centre, *fit).mean()
    return max(placements(), key=score), centre


def mask_fit(mask, crop, style):
    """The scale and shift, as edge_fit gives them, that put a band just inside the outline on the
    object that the style's rule finds in the photograph, and a band just outside it off that
    object."""
    centre = np.array(trace(mask), dtype=float).mean(axis=0)
    inside = np.array(trace(components(erode(mask, BAND))[0]), dtype=float)
    outside = np.array(trace(dilate(mask, BAND)), dtype=float)
    found, _ = object_mask(crop, style)
    score = lambda fit: (
        sample(found, inside, centre, *fit).mean() - sample(found, outside, centre, *fit).mean()
    )
    return max(placements(), key=score), centre


def placement(fit, mask, reference_fit, crop):
    """Where the outline lies on a photograph: (scale, dx, dy) such that the outline point (x, y)
    lies at (x * scale + dx, y * scale + dy), in pixels. The fit of the reference itself is taken
    out, since a fit finds every object a little inside or outside its traced boundary."""
    (s0, dx0, dy0), centre = reference_fit
    (s, dx, dy), _ = fit(mask, crop)
    scale = s / s0
    return scale, *(centre + np.array([dx, dy]) - (centre + np.array([dx0, dy0])) * scale)


def main(arguments):
    preview = Path(arguments[1]) if len(arguments) == 2 and arguments[0] == "--preview" else None
    for style, settings in STYLES.items():
        image = Image.open(ROOT / f"assets/images/material-{style}.jpg").convert("RGB")
        crops = {name: crop_of(image, numbers) for name, numbers in finishes(style)}
        reference_name = settings.reference
        reference = crops[reference_name]
        width, height = reference.size
        mask, kept_holes = object_mask(reference, settings)
        outline = rings(mask, kept_holes)
        flat = lambda ring: ", ".join(
            "%.3f, %.3f" % ((x + 0.5) / width, (y + 0.5) / height) for x, y in ring
        )
        print(f"// {style}: {[len(ring) for ring in outline]} points")
        print("  outline: [" + ", ".join(f"[{flat(ring)}]" for ring in outline) + "],")
        if settings.fit_by_mask:
            fit = lambda mask, crop: mask_fit(mask, crop, settings)
        else:
            fit = edge_fit
        reference_fit = fit(mask, reference)
        for name, crop in crops.items():
            scale, dx, dy = placement(fit, mask, reference_fit, crop)
            print(f'  "{name}": [{scale:.3f}, {dx / width:.3f}, {dy / height:.3f}]')
            if preview:
                preview.mkdir(parents=True, exist_ok=True)
                drawn = crop.copy()
                draw = ImageDraw.Draw(drawn)
                for ring in outline:
                    points = [((x + 0.5) * scale + dx, (y + 0.5) * scale + dy) for x, y in ring]
                    draw.polygon(points, outline=(255, 0, 255), width=1)
                drawn.save(preview / f"{style}-{name.replace(' ', '-').lower()}.png")


if __name__ == "__main__":
    main(sys.argv[1:])
