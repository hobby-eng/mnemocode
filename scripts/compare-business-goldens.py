"""Compare rendered PDF pixels at fixed resolution, ignoring PDF timestamps."""

import argparse
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageChops

RESOLUTION_DPI = 144
FIXTURES = ["words12-a6", "words24-a4", "single-business", "sskr-qr", "glass8", "material"]


def render_pages(pdf: Path, prefix: Path) -> list[Path]:
    subprocess.run(
        ["pdftoppm", "-r", str(RESOLUTION_DPI), "-png", str(pdf), str(prefix)],
        check=True,
    )
    return sorted(prefix.parent.glob(prefix.name + "-*.png"))


def same_pixels(left: Path, right: Path) -> bool:
    with Image.open(left) as left_image, Image.open(right) as right_image:
        before = left_image.convert("RGB")
        after = right_image.convert("RGB")
        return before.size == after.size and ImageChops.difference(before, after).getbbox() is None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    args = parser.parse_args()
    failures = []
    with tempfile.TemporaryDirectory(prefix="mnemocode-golden-") as temporary:
        for name in FIXTURES:
            before = render_pages(args.before / f"{name}.pdf", Path(temporary) / f"{name}-before")
            after = render_pages(args.after / f"{name}.pdf", Path(temporary) / f"{name}-after")
            if len(before) != len(after):
                failures.append(f"{name}: page count differs")
                continue
            for page, (left, right) in enumerate(zip(before, after), start=1):
                if not same_pixels(left, right):
                    failures.append(f"{name} page {page}: pixels differ")
            print(f"{name}: {len(before)} pages compared")
    if failures:
        raise SystemExit("\n".join(failures))
    print(f"All {len(FIXTURES)} public fixtures are pixel-identical at {RESOLUTION_DPI} dpi.")


if __name__ == "__main__":
    main()
