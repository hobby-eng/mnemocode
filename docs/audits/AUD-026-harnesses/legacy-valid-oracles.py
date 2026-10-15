"""Independent legacy-valid bit-packing oracles; first reproduce the published legacy vector.

Run from the repository root with a JSON English BIP39 word list as the argument.
Only public zero entropy and the retained vector are used. No MnemoCode algorithm is imported.
"""

import hashlib
import json
from pathlib import Path
import sys


WORDS = json.loads(Path(sys.argv[1]).read_text())
INDEX = {word: index for index, word in enumerate(WORDS)}


def from_entropy(data):
    """BIP39: entropy followed by its leading SHA-256 checksum bits, as 11-bit indexes."""
    bits = "".join(f"{byte:08b}" for byte in data)
    checksum = f"{hashlib.sha256(data).digest()[0]:08b}"[:len(bits) // 32]
    bits += checksum
    return [int(bits[place:place + 11], 2) for place in range(0, len(bits), 11)]


def legacy(source, dates, valid):
    """Independent Original Seedshift, optionally replacing the derived checksum only."""
    shifts = [value for date in sorted(dates) for value in date]
    positions = [(INDEX[word] + shifts[place % len(shifts)]) % 2048
                 for place, word in enumerate(source.split())]
    if valid:
        length = len(positions) * 11 - len(positions) // 3
        bits = "".join(f"{position:011b}" for position in positions)[:length]
        positions = from_entropy(int(bits, 2).to_bytes(length // 8, "big"))
    return " ".join(WORDS[position] for position in positions)


vectors = json.loads(Path("vectors/mnemocode-v1.json").read_text())["vectors"]
controls = [vector for vector in vectors if vector["mode"] == "seedshift-legacy"]
assert controls, "Require the published Original Seedshift control."
for vector in controls:
    dates = [tuple(map(int, text.split("-")[::-1])) for text in vector["dates"]]
    assert legacy(vector["sourceMnemonic"], dates, False) == vector["english"]
print(json.dumps({"publishedControls": len(controls)}))
for count in [12, 15, 18, 21, 24]:
    source = " ".join(WORDS[index] for index in from_entropy(bytes(count // 3 * 4)))
    print(json.dumps({"words": count, "source": source,
                      "stored": legacy(source, [(2026, 9, 23)], True),
                      "candidates": 2 ** (11 - count // 3)}))
