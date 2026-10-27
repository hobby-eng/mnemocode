//! CRC-32/ISO-HDLC and its big-endian read (TS `src/sskr/checksum.ts:4-32`): the transport checksum
//! of shares and candidate lists and the check of PNG chunks. Error detection, not authentication.

/// The bytes of a CRC-32, as shares and lists store it: big-endian.
pub const CRC32_BYTES: usize = 4;

const CRC32_INITIAL: u32 = 0xffff_ffff;
const CRC32_REFLECTED_POLYNOMIAL: u32 = 0xedb8_8320;

/// The CRC-32/ISO-HDLC of `bytes` (reflected, initial and final value 0xFFFFFFFF).
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = CRC32_INITIAL;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..u8::BITS {
            let polynomial = if crc & 1 == 1 {
                CRC32_REFLECTED_POLYNOMIAL
            } else {
                0
            };
            crc = (crc >> 1) ^ polynomial;
        }
    }
    crc ^ CRC32_INITIAL
}

/// The CRC-32 stored big-endian at `at` in `bytes`, if four bytes are there: how every form of a
/// share and a candidate list keeps its checksum.
pub fn checksum_at(bytes: &[u8], at: usize) -> Option<u32> {
    let stored: [u8; CRC32_BYTES] = bytes
        .get(at..at.checked_add(CRC32_BYTES)?)?
        .try_into()
        .ok()?;
    Some(u32::from_be_bytes(stored))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_gives_the_check_value_of_its_catalogue() {
        // The check value of CRC-32/ISO-HDLC in Greg Cook's catalogue of CRC parameters.
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
        assert_eq!(crc32(b""), 0);
    }

    #[test]
    fn a_stored_checksum_is_read_big_endian() {
        assert_eq!(
            checksum_at(&[9, 0xcb, 0xf4, 0x39, 0x26], 1),
            Some(0xcbf4_3926)
        );
        assert_eq!(checksum_at(&[0xcb, 0xf4, 0x39], 0), None);
        assert_eq!(checksum_at(&[1, 2, 3, 4], usize::MAX), None);
    }
}
