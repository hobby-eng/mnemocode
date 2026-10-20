#!/usr/bin/env python3
r"""Build the DejaVu Sans subset that cards and sheets print with.

The subset is distributed with MnemoCode. It needs fontTools:

    python3 -m pip install --require-hashes \
        -r scripts/build-ui-font-requirements.txt
"""

from pathlib import Path
from hashlib import sha256

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
UI_SOURCE_FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
UI_SOURCE_NOTICE = Path("/usr/share/doc/fonts-dejavu-core/copyright")
OUTPUT_DIR = ROOT / "assets/fonts"
UI_OUTPUT_FONT = OUTPUT_DIR / "DejaVuSans-UI.ttf"
UI_OUTPUT_NOTICE = OUTPUT_DIR / "DejaVuSans-NOTICE"
SOURCE_DIGESTS = {
    UI_SOURCE_FONT: (
        "b4c632e3cdf9acc7f28758fb5a323c8524d7fc6660d46904d9b6cbe2809c419c"
    ),
    UI_SOURCE_NOTICE: (
        "63d3ba759d12804c5b31a9d5940d855c1820d1f5999e6b0872eb1c7ff045fbc9"
    ),
}


class FontSourceError(RuntimeError):
    """The installed upstream font is not the build's pinned input."""

    code = "font-source-integrity"


def main() -> None:
    for path, digest in SOURCE_DIGESTS.items():
        if sha256(path.read_bytes()).hexdigest() != digest:
            raise FontSourceError(
                "The DejaVu source font or license has changed."
            )
    options = subset.Options()
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    options.name_languages = [0x409]
    # Keep Latin diacritics used by international names, combining marks
    # and typography punctuation, as well as the existing Cyrillic
    # coverage.
    ui_ranges = [
        (0x20, 0x250),
        (0x300, 0x370),
        (0x400, 0x530),
        (0x2000, 0x2070),
    ]
    ui_glyphs = "".join(
        chr(codepoint)
        for start, end in ui_ranges
        for codepoint in range(start, end)
    )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ui_font = TTFont(str(UI_SOURCE_FONT), recalcTimestamp=False)
    ui_subsetter = subset.Subsetter(options=options)
    ui_subsetter.populate(text=ui_glyphs)
    ui_subsetter.subset(ui_font)
    ui_font.save(str(UI_OUTPUT_FONT))
    notice = UI_SOURCE_NOTICE.read_text(encoding="utf-8")
    UI_OUTPUT_NOTICE.write_text(notice, encoding="utf-8")
    print(f"Saved {UI_OUTPUT_FONT} ({UI_OUTPUT_FONT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
