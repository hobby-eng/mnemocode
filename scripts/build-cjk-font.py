#!/usr/bin/env python3
"""Build the distributable Traditional Chinese BIP39 subset of Droid Sans Fallback."""

from pathlib import Path
import re

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
WORDLIST = ROOT / "node_modules/@scure/bip39/wordlists/traditional-chinese.js"
SOURCE_FONT = Path("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf")
SOURCE_NOTICE = Path("/usr/share/doc/fonts-droid-fallback/copyright")
APACHE_LICENSE = Path("/usr/share/common-licenses/Apache-2.0")
UI_SOURCE_FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
UI_SOURCE_NOTICE = Path("/usr/share/doc/fonts-dejavu-core/copyright")
OUTPUT_DIR = ROOT / "assets/fonts"
OUTPUT_FONT = OUTPUT_DIR / "DroidSansFallback-BIP39.ttf"
OUTPUT_NOTICE = OUTPUT_DIR / "DroidSansFallback-NOTICE"
UI_OUTPUT_FONT = OUTPUT_DIR / "DejaVuSans-UI.ttf"
UI_OUTPUT_NOTICE = OUTPUT_DIR / "DejaVuSans-NOTICE"


def main() -> None:
    source = WORDLIST.read_text(encoding="utf-8")
    match = re.search(r"Object\.freeze\(`(.*?)`\.split", source, re.DOTALL)
    if match is None:
        raise RuntimeError("Unable to read the Traditional Chinese BIP39 word list")
    glyphs = "".join(match.group(1).splitlines())
    font = TTFont(str(SOURCE_FONT))
    options = subset.Options()
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    options.name_languages = [0x409]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=glyphs)
    subsetter.subset(font)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    font.save(str(OUTPUT_FONT))
    OUTPUT_NOTICE.write_text(
        SOURCE_NOTICE.read_text(encoding="utf-8")
        + "\n\nFull Apache License 2.0\n=======================\n\n"
        + APACHE_LICENSE.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    # Keep Latin diacritics used by international names, combining marks and
    # typography punctuation, as well as the existing Cyrillic coverage.
    ui_ranges = [(0x20, 0x250), (0x300, 0x370), (0x400, 0x530), (0x2000, 0x2070)]
    ui_glyphs = "".join(
        chr(codepoint)
        for start, end in ui_ranges
        for codepoint in range(start, end)
    )
    ui_font = TTFont(str(UI_SOURCE_FONT))
    ui_subsetter = subset.Subsetter(options=options)
    ui_subsetter.populate(text=ui_glyphs)
    ui_subsetter.subset(ui_font)
    ui_font.save(str(UI_OUTPUT_FONT))
    UI_OUTPUT_NOTICE.write_text(UI_SOURCE_NOTICE.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"Saved {OUTPUT_FONT} ({OUTPUT_FONT.stat().st_size} bytes)")
    print(f"Saved {UI_OUTPUT_FONT} ({UI_OUTPUT_FONT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
