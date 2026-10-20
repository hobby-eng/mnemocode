"""Restores the SSKR shares of vectors/sskr-v1.json independently.

    python3 scripts/verify-sskr-known-answers.py

The known answers of SSKR that MnemoCode checks its share engine with
(src/sskr/known-answers.ts) must not come from that engine alone. This
script restores them without it, from the published format: Bytewords
(BCR-2020-012) with their CRC-32, the CBOR byte string of a UR, the
metadata of an SSKR share (BCR-2020-011), and Shamir's secret sharing
over GF(2^8) as Blockchain Commons' bc-shamir does it: Lagrange
interpolation at x = 255 for the secret and at x = 254 for its digest,
the first four bytes of HMAC-SHA-256 of the secret keyed by the rest of
that point.

It first restores the official BCR-2020-011 vector from each of its
valid quorums and refuses each of its invalid ones; only then the
deterministic sets, among them the 32-byte secret of a 24-word phrase
(bip39-256-2-of-3), from every pair of their shares. Only the word list
is read from the repository (src/sskr/bytewords-list.ts): a wrong word
would fail the CRC-32 of a share or the official secret. It prints one
line per vector and exits with 1 at the first difference. It needs only
Python 3. All data is public test data.
"""

import hashlib
import hmac
import itertools
import json
import re
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VECTORS = ROOT / "vectors/sskr-v1.json"
WORD_LIST = ROOT / "src/sskr/bytewords-list.ts"

# BCR-2020-011 and bc-shamir.
SECRET_X = 255
DIGEST_X = 254
DIGEST_BYTES = 4
METADATA_BYTES = 5
# The CRC-32 at the end of a UR's bytes, big-endian.
CRC_BYTES = 4
# The polynomial of the field, x^8 + x^4 + x^3 + x + 1, as in AES and
# bc-shamir.
FIELD_POLYNOMIAL = 0x11B
# The CBOR major type of a byte string, in the top three bits of its
# first byte.
CBOR_BYTE_STRING = 2
CBOR_ONE_BYTE_LENGTH = 24


def minimal_bytewords():
    """Each byte by its minimal Byteword, its first and last letters."""
    words = re.findall(r'"([a-z]{4})"', WORD_LIST.read_text())
    if len(words) != 256 or len(set(words)) != 256:
        raise ValueError("The Bytewords list must have 256 different words.")
    return {word[0] + word[-1]: value for value, word in enumerate(words)}


def share_bytes(ur, letters):
    """The SSKR share of a ur:sskr text.

    Its Bytewords are read, its CRC-32 checked and its CBOR undone.
    """
    body = ur.removeprefix("ur:sskr/")
    data = bytes(letters[body[i : i + 2]] for i in range(0, len(body), 2))
    payload, crc = data[:-CRC_BYTES], data[-CRC_BYTES:]
    if zlib.crc32(payload).to_bytes(CRC_BYTES, "big") != crc:
        raise ValueError(f"CRC-32 fails: {ur}")
    head = payload[0]
    if head >> 5 != CBOR_BYTE_STRING:
        raise ValueError(f"Not a CBOR byte string: {ur}")
    length, start = head & 0x1F, 1
    if length == CBOR_ONE_BYTE_LENGTH:
        length, start = payload[1], 2
    share = payload[start:]
    if len(share) != length:
        raise ValueError(f"CBOR length differs: {ur}")
    return share


class Share:
    """The metadata of an SSKR share (BCR-2020-011) and its value."""

    def __init__(self, data):
        self.identifier = data[0] << 8 | data[1]
        self.group_threshold = (data[2] >> 4) + 1
        self.group_count = (data[2] & 0x0F) + 1
        self.group = data[3] >> 4
        self.member_threshold = (data[3] & 0x0F) + 1
        if data[4] >> 4 != 0:
            raise ValueError("Reserved bits must be zero.")
        self.member = data[4] & 0x0F
        self.value = data[METADATA_BYTES:]


def multiply(a, b):
    """The product in GF(2^8) with FIELD_POLYNOMIAL."""
    product = 0
    while b:
        if b & 1:
            product ^= a
        a <<= 1
        if a & 0x100:
            a ^= FIELD_POLYNOMIAL
        b >>= 1
    return product


def inverse(a):
    """a^254, which is 1/a in GF(2^8)."""
    result, power, exponent = 1, a, 254
    while exponent:
        if exponent & 1:
            result = multiply(result, power)
        power = multiply(power, power)
        exponent >>= 1
    return result


def interpolate(points, x):
    """The value at `x` of the polynomials through `points`.

    The points are (x, bytes) pairs, interpolated byte by byte.
    """
    length = len(points[0][1])
    result = bytearray(length)
    for i, (xi, yi) in enumerate(points):
        basis = 1
        for j, (xj, _) in enumerate(points):
            if i != j:
                # Subtraction is addition, which is XOR, in GF(2^8).
                basis = multiply(basis, multiply(x ^ xj, inverse(xi ^ xj)))
        for k in range(length):
            result[k] ^= multiply(basis, yi[k])
    return bytes(result)


def recover(threshold, points):
    """The secret of `threshold` points, (x, bytes) pairs.

    It is refused when its digest fails.
    """
    if len(points) < threshold:
        raise ValueError("Too few shares.")
    points = points[:threshold]
    if threshold == 1:
        return points[0][1]
    secret = interpolate(points, SECRET_X)
    digest = interpolate(points, DIGEST_X)
    key = digest[DIGEST_BYTES:]
    check = hmac.new(key, secret, hashlib.sha256).digest()[:DIGEST_BYTES]
    if check != digest[:DIGEST_BYTES]:
        raise ValueError("The digest of the secret fails.")
    return secret


def combine(shares):
    """The master secret of SSKR shares.

    Each group's secret comes from its members, then the master secret
    from the secrets of the groups.
    """
    sets = {(s.identifier, s.group_threshold, s.group_count) for s in shares}
    if len(sets) != 1:
        raise ValueError("Shares of different sets.")
    if len({(s.group, s.member) for s in shares}) != len(shares):
        raise ValueError("The same member twice.")
    groups = {}
    for share in shares:
        groups.setdefault(share.group, []).append(share)
    secrets = []
    for group, members in sorted(groups.items()):
        threshold = members[0].member_threshold
        if len(members) >= threshold:
            points = [(m.member, m.value) for m in members]
            secrets.append((group, recover(threshold, points)))
    return recover(shares[0].group_threshold, secrets)


def refused(shares):
    try:
        combine(shares)
    except ValueError:
        return True
    return False


def main():
    letters = minimal_bytewords()
    vectors = json.loads(VECTORS.read_text())
    official = vectors["official"]
    shares = [Share(share_bytes(ur, letters)) for ur in official["shares"]]
    for quorum in official["validQuorums"]:
        restored = combine([shares[i] for i in quorum]).hex()
        if restored != official["entropy"]:
            sys.exit(
                f"Official quorum {quorum} gives {restored}, "
                f"not {official['entropy']}."
            )
    for quorum in official["invalidQuorums"]:
        if not refused([shares[i] for i in quorum]):
            sys.exit(f"Official quorum {quorum} was not refused.")
    print(
        f"official BCR-2020-011: {official['entropy']} "
        "from every valid quorum"
    )
    for vector in vectors["deterministic"]:
        shares = [Share(share_bytes(ur, letters)) for ur in vector["shares"]]
        threshold = vector["groups"][0]["threshold"]
        for chosen in itertools.combinations(shares, threshold):
            restored = combine(list(chosen)).hex()
            if restored != vector["entropy"]:
                sys.exit(
                    f"{vector['name']} gives {restored}, "
                    f"not {vector['entropy']}."
                )
        if not refused(shares[: threshold - 1]):
            sys.exit(f"{vector['name']}: too few shares were not refused.")
        print(
            f"{vector['name']}: {vector['entropy']} "
            f"from every {threshold} of its shares"
        )


if __name__ == "__main__":
    main()
