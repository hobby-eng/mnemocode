//! Arithmetic in GF(2^8) with the AES polynomial x^8 + x^4 + x^3 + x + 1 (MnemoCode TS 0.1.0's
//! `src/sskr/gf256.ts`), the field in which bc-shamir splits a secret: a share is the value of one
//! polynomial per byte at its member index, the secret at 255 and the digest at 254. Multiplying by
//! a known constant is linear over GF(2), which lets the joint repair write Shamir's interpolation
//! as equations in the bits of marked elements. Its callers pick distinct points by construction,
//! so neither a zero inverse nor equal points are guarded (CORE-54).

/// The reduction polynomial of the field, with its x^8 term.
const REDUCTION: u16 = 0x11b;
/// Nonzero elements, the powers of 3.
const ORDER: usize = 255;

/// The x at which bc-shamir keeps the secret.
pub(crate) const SECRET_X: u8 = 255;
/// The x at which bc-shamir keeps the digest share.
pub(crate) const DIGEST_X: u8 = 254;

/// The powers of 3, twice over, and the logarithm of each nonzero element.
const TABLES: ([u8; 2 * ORDER], [u8; 256]) = {
    let mut exp = [0_u8; 2 * ORDER];
    let mut log = [0_u8; 256];
    let mut value: u16 = 1;
    let mut power = 0;
    while power < ORDER {
        exp[power] = value as u8;
        exp[power + ORDER] = value as u8;
        log[value as usize] = power as u8;
        let doubled = (value << 1) ^ if value & 0x80 != 0 { REDUCTION } else { 0 };
        value = (doubled ^ value) & 0xff;
        power += 1;
    }
    (exp, log)
};

/// The product of `a` and `b`, as bc-shamir multiplies.
pub(crate) fn multiply(a: u8, b: u8) -> u8 {
    if a == 0 || b == 0 {
        return 0;
    }
    TABLES.0[usize::from(TABLES.1[usize::from(a)]) + usize::from(TABLES.1[usize::from(b)])]
}

/// The inverse of `a`, nonzero.
fn inverse(a: u8) -> u8 {
    TABLES.0[ORDER - usize::from(TABLES.1[usize::from(a)])]
}

/// The Lagrange coefficients l_i(at) for the distinct points `xs`: the value at `at` of the
/// polynomial of lowest degree through them is the sum of l_i(at) times the value at `xs[i]`.
pub(crate) fn lagrange_coefficients(xs: &[u8], at: u8) -> Vec<u8> {
    xs.iter()
        .enumerate()
        .map(|(i, &xi)| {
            xs.iter()
                .enumerate()
                .filter(|&(j, _)| j != i)
                .fold(1, |product, (_, &xj)| {
                    multiply(product, multiply(at ^ xj, inverse(xi ^ xj)))
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_field_multiplies_as_aes_does() {
        assert_eq!(multiply(0x57, 0x83), 0xc1);
        assert_eq!(multiply(0x57, 0x13), 0xfe);
        assert_eq!(multiply(inverse(0x53), 0x53), 1);
        // A line c0 + c1 x read at 3 and 9 gives c0 back at 0, and itself at 200.
        let line = |x: u8| 0x12 ^ multiply(0x34, x);
        for at in [0, 200] {
            let coefficients = lagrange_coefficients(&[3, 9], at);
            let value = multiply(coefficients[0], line(3)) ^ multiply(coefficients[1], line(9));
            assert_eq!(value, line(at));
        }
    }
}
