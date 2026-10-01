"""Independent oracle for the MnemoCode transformations (AUD-005).

The checksum-valid Seedshift translation is implemented here from
docs/SEEDSHIFT_CONSTRUCTION.md and BIP39 with Python's hashlib, not from the
TypeScript source. It is compared with vectors/mnemocode-v1.json and with the
built library (dist/) on deterministic pseudo-random public cases.

Run from the repository root after `pnpm build`:
    python3 docs/audits/AUD-005-harnesses/seedshift-oracle.py
Exit 0 means every comparison matched; any mismatch exits 1.
"""

import hashlib
import json
from pathlib import Path
import random
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
# SHA-256 of the official BIP39 english.txt (2048 lines, each ending in a newline).
OFFICIAL_ENGLISH_SHA256 = "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda"
# The product's own pin of the Traditional Chinese list joined by newlines
# (src/cli/self-test.ts). This one is not independent: it only detects drift.
PRODUCT_CHINESE_SHA256 = "407312f9014543242bd157c255125a753ac60128fc15883a33b8685a9328b0cc"
WORD_COUNTS = [12, 15, 18, 21, 24]
RANDOM_CASES = 400
SEED = 20261001

failures = []


def check(condition, what):
    if not condition:
        failures.append(what)


def node_json(script, payload=None):
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        input=json.dumps(payload) if payload is not None else None,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


lists = node_json(
    "import {wordlist as e} from '@scure/bip39/wordlists/english.js';"
    "import {wordlist as c} from '@scure/bip39/wordlists/traditional-chinese.js';"
    "console.log(JSON.stringify({e, c}))"
)
ENGLISH = lists["e"]
CHINESE = lists["c"]
english_text = "".join(word + "\n" for word in ENGLISH).encode()
check(hashlib.sha256(english_text).hexdigest() == OFFICIAL_ENGLISH_SHA256, "English list is not the official BIP39 list")
check(hashlib.sha256("\n".join(CHINESE).encode()).hexdigest() == PRODUCT_CHINESE_SHA256, "Chinese list differs from the product pin")
INDEX = {word: i for i, word in enumerate(ENGLISH)}


def entropy_to_indexes(entropy):
    bits = len(entropy) * 8
    checksum_bits = bits // 32
    value = int.from_bytes(entropy, "big")
    checksum = hashlib.sha256(entropy).digest()[0] >> (8 - checksum_bits)
    total = (value << checksum_bits) | checksum
    count = (bits + checksum_bits) // 11
    return [(total >> (11 * (count - 1 - i))) & 2047 for i in range(count)]


def indexes_to_entropy(indexes):
    count = len(indexes)
    checksum_bits = count // 3
    total = 0
    for index in indexes:
        total = (total << 11) | index
    entropy_bits = 11 * count - checksum_bits
    entropy = (total >> checksum_bits).to_bytes(entropy_bits // 8, "big")
    if entropy_to_indexes(entropy) != list(indexes):
        raise ValueError("invalid checksum")
    return entropy


def shift_vector(dates, count):
    # Sorted dates, expanded to year, month, day and repeated (construction document).
    sequence = [part for date in sorted(dates) for part in date]
    return [sequence[i % len(sequence)] for i in range(count)]


def translate(indexes, dates, sign):
    """T_s on (Z_2048)^(n-1) x Z_(2^r); sign -1 gives the inverse."""
    count = len(indexes)
    r = 11 - count // 3
    entropy = int.from_bytes(indexes_to_entropy(indexes), "big")
    entropy_bits = 11 * (count - 1) + r
    blocks = [(entropy >> (entropy_bits - 11 * (i + 1))) & 2047 for i in range(count - 1)]
    tail = entropy & ((1 << r) - 1)
    s = shift_vector(dates, count)
    blocks = [(b + sign * s[i]) % 2048 for i, b in enumerate(blocks)]
    tail = (tail + sign * s[-1]) % (1 << r)
    value = 0
    for b in blocks:
        value = (value << 11) | b
    value = (value << r) | tail
    return entropy_to_indexes(value.to_bytes(entropy_bits // 8, "big"))


def legacy(indexes, dates, sign):
    s = shift_vector(dates, len(indexes))
    return [(index + sign * s[i]) % 2048 for i, index in enumerate(indexes)]


def colors(indexes):
    digits = "".join(f"{i + 1:04d}" for i in indexes)
    result = []
    for position in range(len(digits) // 6):
        tag = position * 2 if len(indexes) == 12 else position
        result.append(f"#{int(f'{tag}{digits[position * 6:position * 6 + 6]}'):06X}")
    return result


def colors_unicode(codes):
    out = ""
    for code in codes:
        value = int(code[1:], 16)
        out += f"{0xE000 + value // 0x1900:04X}{0xE000 + value % 0x1900:04X}"
    return out


def representations(indexes):
    return {
        "english": " ".join(ENGLISH[i] for i in indexes),
        "indexes": " ".join(str(i + 1) for i in indexes),
        "unicode": "".join(f"{ord(CHINESE[i]):04X}" for i in indexes),
        "colors": " ".join(colors(indexes)),
        "colorsUnicode": colors_unicode(colors(indexes)),
    }


def parse_date(text):
    day, month, year = text.split("-")
    return (int(year), int(month), int(day))


# 1. The published vector file.
vectors = json.loads((ROOT / "vectors/mnemocode-v1.json").read_text())["vectors"]
for vector in vectors:
    source = [INDEX[w] for w in vector["sourceMnemonic"].split()]
    dates = [parse_date(d) for d in vector["dates"]]
    if vector["mode"] == "direct":
        expected = source
    elif vector["mode"] == "seedshift":
        expected = translate(source, dates, +1)
        check(translate(expected, dates, -1) == source, f"{vector['name']}: inverse")
    else:
        expected = legacy(source, dates, +1)
    for key, text in representations(expected).items():
        check(vector[key] == text, f"{vector['name']}: {key}")

# 2. Deterministic pseudo-random public cases against the built library.
generator = random.Random(SEED)
cases = []
for number in range(RANDOM_CASES):
    count = WORD_COUNTS[number % len(WORD_COUNTS)]
    entropy = bytes(generator.getrandbits(8) for _ in range(count * 4 // 3))
    # Include the all-zero and all-0xFF extremes on the first cases.
    if number < 5:
        entropy = bytes(len(entropy))
    elif number < 10:
        entropy = bytes([255]) * len(entropy)
    date_count = generator.randint(1, count // 3)
    dates = []
    for _ in range(date_count):
        year = generator.choice([1, 2, 2047, 2048, 2049, 4095, 9999, generator.randint(1, 9999)])
        month = generator.randint(1, 12)
        day = generator.randint(1, 28)
        dates.append((year, month, day))
    source = entropy_to_indexes(entropy)
    cases.append(
        {
            "mnemonic": " ".join(ENGLISH[i] for i in source),
            "dates": [f"{d:02d}-{m:02d}-{y:04d}" for (y, m, d) in dates],
            "seedshift": representations(translate(source, dates, +1)),
            "legacy": representations(legacy(source, dates, +1)),
            "direct": representations(source),
        }
    )

LIBRARY = """
import * as m from './dist/index.js';
let text = '';
for await (const chunk of process.stdin) text += chunk;
const formats = {english:'english', indexes:'indexes', unicode:'unicode', colors:'colors', colorsUnicode:'colors-unicode'};
const out = JSON.parse(text).map((c) => {
  const dates = c.dates.map(m.parseDate);
  const row = {};
  for (const [mode, result] of [['seedshift', m.encodeMnemonic(c.mnemonic, dates)],
                                ['legacy', m.encodeMnemonicLegacy(c.mnemonic, dates)],
                                ['direct', m.representMnemonic(c.mnemonic)]]) {
    row[mode] = {};
    for (const [key, format] of Object.entries(formats)) {
      const encoded = m.formatEncoded(result, format);
      const back = mode === 'seedshift' ? m.decodeInput(encoded, format, dates)
        : mode === 'legacy' ? m.decodeInputLegacy(encoded, format, dates)
        : m.decodeInputDirect(encoded, format);
      row[mode][key] = [encoded, back.recoveredMnemonic === c.mnemonic];
    }
  }
  return row;
});
console.log(JSON.stringify(out));
"""
library = node_json(LIBRARY, cases)
comparisons = 0
for number, (case, row) in enumerate(zip(cases, library)):
    for mode in ("seedshift", "legacy", "direct"):
        for key, expected in case[mode].items():
            encoded, round_trip = row[mode][key]
            comparisons += 1
            check(encoded == expected, f"case {number} {mode} {key}: {encoded} != {expected}")
            check(round_trip, f"case {number} {mode} {key}: round trip")

print(
    json.dumps(
        {
            "englishListOfficial": hashlib.sha256(english_text).hexdigest() == OFFICIAL_ENGLISH_SHA256,
            "vectors": len(vectors),
            "randomCases": len(cases),
            "libraryComparisons": comparisons,
            "failures": failures[:20],
            "failureCount": len(failures),
        },
        indent=2,
    )
)
sys.exit(1 if failures else 0)
