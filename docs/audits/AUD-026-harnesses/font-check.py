"""Rebuild the pinned UI font and compare baseline glyphs without rendering any PDF.

Use the environment from scripts/build-ui-font-requirements.txt; the canonical
builder owns the dependency pins and source hashes, rather than this audit.
"""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import subprocess
import sys

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

font_path = Path("assets/fonts/DejaVuSans-UI.ttf")
before = sha256(font_path.read_bytes()).hexdigest()
subprocess.run([sys.executable, "-B", "scripts/build-ui-font.py"], check=True)
assert sha256(font_path.read_bytes()).hexdigest() == before, "Rebuild bytes changed"
baseline_blob = subprocess.check_output([
    "git", "show",
    "f2d4cffa5d7df369910243734f287ce6521ed033:assets/fonts/DejaVuSans-UI.ttf",
])
old = TTFont(BytesIO(baseline_blob))
new = TTFont(font_path)
old_map, new_map = old.getBestCmap(), new.getBestCmap()
assert old_map.keys() <= new_map.keys()
glyph_sets = old.getGlyphSet(), new.getGlyphSet()
for codepoint, name in old_map.items():
    other = new_map[codepoint]
    assert old["hmtx"][name] == new["hmtx"][other], codepoint
    drawings = []
    for glyphs, glyph_name in zip(glyph_sets, (name, other)):
        pen = DecomposingRecordingPen(glyphs)
        glyphs[glyph_name].draw(pen)
        drawings.append(pen.value)
    assert drawings[0] == drawings[1], codepoint
print({
    "sha256": before,
    "bytes": font_path.stat().st_size,
    "retainedGlyphsCompared": len(old_map),
    "addedCodepoints": len(new_map) - len(old_map),
    "sameRebuildBytes": True,
    "retainedOutlinesAndMetricsEqual": True,
})
