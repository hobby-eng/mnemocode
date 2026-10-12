"""Independently derive two zero-entropy color answers without importing MnemoCode."""

import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
DECIMAL_WORD_DIGITS = 4
DECIMAL_COLOR_DIGITS = 6
PRIVATE_USE_BASE = 0xE000
PRIVATE_USE_RADIX = 0x1900


def answer(entropy_bytes):
    entropy = bytes(entropy_bytes)
    checksum_bits = entropy_bytes * 8 // 32
    bits = "0" * (entropy_bytes * 8) + f"{hashlib.sha256(entropy).digest()[0]:08b}"[:checksum_bits]
    # BIP39 indexes consume eleven bits; MnemoCode numbers words starting at one.
    numbers = [int(bits[i:i + 11], 2) + 1 for i in range(0, len(bits), 11)]
    decimal = "".join(f"{number:0{DECIMAL_WORD_DIGITS}d}" for number in numbers)
    chunks = [decimal[i:i + DECIMAL_COLOR_DIGITS] for i in range(0, len(decimal), DECIMAL_COLOR_DIGITS)]
    # Eight-color sheets use tags 0, 2, ..., 14; sixteen-color sheets use tags 0, 1, ..., 15.
    stride = 2 if len(chunks) == 8 else 1
    colors = [int(str(i * stride) + chunk) for i, chunk in enumerate(chunks)]
    private = "".join(f"{PRIVATE_USE_BASE + color // PRIVATE_USE_RADIX:04X}"
                      f"{PRIVATE_USE_BASE + color % PRIVATE_USE_RADIX:04X}" for color in colors)
    return {"indexes": " ".join(map(str, numbers)),
            "colors": " ".join(f"#{color:06X}" for color in colors),
            "colorsUnicode": private}


if __name__ == "__main__":
    fixture = next(row for row in json.loads((ROOT / "vectors/mnemocode-v1.json").read_text())["vectors"]
                   if row["name"] == "direct-12")
    first = answer(16)
    assert all(fixture[key] == value for key, value in first.items()), "12-word reference mismatch"
    second = answer(32)
    source = (ROOT / "src/core/representations-self-test.ts").read_text()
    # Compare against retained literals, not values obtained by calling the production encoder.
    for key, value in second.items():
        assert re.search(re.escape('"' + value + '"'), source), f"24-word {key} oracle mismatch"
    print(json.dumps({"reference12Reproduced": True, "zeroEntropy24": second}, indent=2))
