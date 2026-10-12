"""Compare rendered PDF pixels at fixed resolution, ignoring PDF timestamps.

Every PDF of the two folders is compared: the fixtures are what business-goldens.mjs wrote, so a
new fixture needs no list here, and a file found in only one folder is a failure.
"""

import argparse
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageChops

RESOLUTION_DPI = 144


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


def fixture_names(folder: Path) -> set[str]:
    return {pdf.stem for pdf in folder.glob("*.pdf")}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    args = parser.parse_args()
    before_names = fixture_names(args.before)
    after_names = fixture_names(args.after)
    failures = [f"{name}: only in {args.before}" for name in sorted(before_names - after_names)]
    failures += [f"{name}: only in {args.after}" for name in sorted(after_names - before_names)]
    names = sorted(before_names & after_names)
    if not names:
        failures.append("no PDF fixture to compare")
    with tempfile.TemporaryDirectory(prefix="mnemocode-golden-") as temporary:
        for name in names:
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
    print(f"All {len(names)} public fixtures are pixel-identical at {RESOLUTION_DPI} dpi.")


if __name__ == "__main__":
    main()
