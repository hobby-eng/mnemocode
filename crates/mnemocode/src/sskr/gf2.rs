//! Linear algebra over GF(2) (MnemoCode TS 0.1.0's `src/sskr/gf2.ts`): bit vectors in which bit i
//! of a column is equation i. The repair of a marked share writes every check of it as such
//! equations in the bits of its unreadable elements and solves them here, instead of trying values.

use std::fmt;

/// The bits of one word of a vector.
const WORD_BITS: usize = 64;

/// A bit vector of any length, bit i its coordinate i; part of a share's secret where it holds
/// unit values, so its `Debug` shows nothing and the zeroing allocator wipes its words when freed.
#[derive(Clone, Default, PartialEq, Eq)]
pub(crate) struct Bits(Vec<u64>);

impl fmt::Debug for Bits {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "bits")
    }
}

impl Bits {
    /// The vector with no bit set.
    pub(crate) const fn zero() -> Self {
        Self(Vec::new())
    }

    /// The vector with bit `bit` alone set.
    pub(crate) fn unit(bit: usize) -> Self {
        let mut bits = Self::zero();
        bits.set(bit);
        bits
    }

    /// The vector of the low `width` bits of `value`.
    pub(crate) fn of(value: u64, width: usize) -> Self {
        let mut bits = Self::zero();
        bits.put(0, width, value);
        bits
    }

    /// The low `width` bits all set.
    pub(crate) fn ones(width: usize) -> Self {
        let mut bits = Self(vec![u64::MAX; width / WORD_BITS]);
        if !width.is_multiple_of(WORD_BITS) {
            bits.0.push((1 << (width % WORD_BITS)) - 1);
        }
        bits
    }

    /// Whether no bit is set.
    pub(crate) fn is_zero(&self) -> bool {
        self.0.iter().all(|&word| word == 0)
    }

    /// The index of the highest set bit; none for zero.
    pub(crate) fn top_bit(&self) -> Option<usize> {
        self.0.iter().enumerate().rev().find_map(|(index, &word)| {
            (word != 0).then(|| index * WORD_BITS + (WORD_BITS - 1 - word.leading_zeros() as usize))
        })
    }

    /// Whether bit `bit` is set.
    pub(crate) fn bit(&self, bit: usize) -> bool {
        self.0
            .get(bit / WORD_BITS)
            .is_some_and(|word| word >> (bit % WORD_BITS) & 1 == 1)
    }

    /// Sets bit `bit`.
    pub(crate) fn set(&mut self, bit: usize) {
        let word = bit / WORD_BITS;
        if self.0.len() <= word {
            self.0.resize(word + 1, 0);
        }
        self.0[word] |= 1 << (bit % WORD_BITS);
    }

    /// Flips every bit that `other` sets.
    pub(crate) fn xor_assign(&mut self, other: &Self) {
        if self.0.len() < other.0.len() {
            self.0.resize(other.0.len(), 0);
        }
        for (word, &flip) in self.0.iter_mut().zip(&other.0) {
            *word ^= flip;
        }
    }

    /// The sum of the two vectors.
    pub(crate) fn xor(&self, other: &Self) -> Self {
        let mut sum = self.clone();
        sum.xor_assign(other);
        sum
    }

    /// The bits set in both.
    pub(crate) fn and(&self, other: &Self) -> Self {
        Self(
            self.0
                .iter()
                .zip(&other.0)
                .map(|(&left, &right)| left & right)
                .collect(),
        )
    }

    /// The vector moved `places` bits up.
    pub(crate) fn shifted_up(&self, places: usize) -> Self {
        let mut moved = Self::zero();
        for bit in (0..self.0.len() * WORD_BITS).filter(|&bit| self.bit(bit)) {
            moved.set(bit + places);
        }
        moved
    }

    /// The vector moved `places` bits down, the lowest dropped.
    pub(crate) fn shifted_down(&self, places: usize) -> Self {
        let mut moved = Self::zero();
        for bit in (places..self.0.len() * WORD_BITS).filter(|&bit| self.bit(bit)) {
            moved.set(bit - places);
        }
        moved
    }

    /// Bits set in either.
    pub(crate) fn or(&self, other: &Self) -> Self {
        let mut either = self.clone();
        if either.0.len() < other.0.len() {
            either.0.resize(other.0.len(), 0);
        }
        for (word, &more) in either.0.iter_mut().zip(&other.0) {
            *word |= more;
        }
        either
    }

    /// `bytes` as one vector, byte i at bits 8i to 8i + 7.
    pub(crate) fn of_bytes(bytes: &[u8]) -> Self {
        let mut bits = Self::zero();
        for (index, &byte) in bytes.iter().enumerate() {
            bits.put(index * 8, 8, u64::from(byte));
        }
        bits
    }

    /// The `width` bits from bit `shift` on, `width` at most 64.
    pub(crate) fn field(&self, shift: usize, width: usize) -> u64 {
        (0..width)
            .filter(|&bit| self.bit(shift + bit))
            .fold(0, |value, bit| value | 1 << bit)
    }

    /// Sets the bits of the low `width` bits of `value` from bit `shift` on, `width` at most 64.
    pub(crate) fn put(&mut self, shift: usize, width: usize, value: u64) {
        for bit in (0..width).filter(|&bit| value >> bit & 1 == 1) {
            self.set(shift + bit);
        }
    }
}

/// The sum of the `vectors` that the bits of `choice` pick: bit i picks vector i.
pub(crate) fn combination(vectors: &[Bits], choice: &Bits) -> Bits {
    let mut sum = Bits::zero();
    for (index, vector) in vectors.iter().enumerate() {
        if choice.bit(index) {
            sum.xor_assign(vector);
        }
    }
    sum
}

/// A vector with its companion, which records what the vector stands for.
#[derive(Clone, Debug)]
pub(crate) struct Reduced {
    /// The vector; once reduced, zero when the pivots already span it.
    pub(crate) vector: Bits,
    /// What the vector stands for, changed by the same sums.
    pub(crate) companion: Bits,
}

/// Vectors in echelon form, each the only one with its highest bit (its pivot), each with a
/// companion changed alike.
#[derive(Debug, Default)]
pub(crate) struct PivotBasis {
    /// The pivots in the order they were added, and the place of each by its highest bit.
    pivots: Vec<Reduced>,
    by_top: std::collections::BTreeMap<usize, usize>,
}

impl PivotBasis {
    /// `vector` reduced by the pivots, with `companion` changed alike.
    pub(crate) fn reduce(&self, vector: &Bits, companion: &Bits) -> Reduced {
        let mut reduced = vector.clone();
        let mut changed = companion.clone();
        while let Some(top) = reduced.top_bit() {
            let Some(&place) = self.by_top.get(&top) else {
                break;
            };
            reduced.xor_assign(&self.pivots[place].vector);
            changed.xor_assign(&self.pivots[place].companion);
        }
        Reduced {
            vector: reduced,
            companion: changed,
        }
    }

    /// Reduces `vector` and keeps the result as a pivot when it is not zero; what it reduced to.
    pub(crate) fn add(&mut self, vector: &Bits, companion: &Bits) -> Reduced {
        let reduced = self.reduce(vector, companion);
        if let Some(top) = reduced.vector.top_bit() {
            self.by_top.insert(top, self.pivots.len());
            self.pivots.push(reduced.clone());
        }
        reduced
    }

    /// The pivots' vectors, in the order they were added.
    pub(crate) fn vectors(&self) -> Vec<Bits> {
        self.pivots
            .iter()
            .map(|pivot| pivot.vector.clone())
            .collect()
    }
}

/// A solution of A x = b: one solution, and the basis of the differences between solutions.
#[derive(Debug)]
pub(crate) struct Solved {
    /// One solution.
    pub(crate) particular: Bits,
    /// Each a combination of unknowns that changes nothing.
    pub(crate) free: Vec<Bits>,
}

/// Solves A x = b over GF(2), with A given by its `columns`; none without a solution.
pub(crate) fn solve(columns: &[Bits], target: &Bits) -> Option<Solved> {
    let mut basis = PivotBasis::default();
    let mut free = Vec::new();
    for (index, column) in columns.iter().enumerate() {
        let reduced = basis.add(column, &Bits::unit(index));
        if reduced.vector.is_zero() {
            free.push(reduced.companion);
        }
    }
    let rest = basis.reduce(target, &Bits::zero());
    rest.vector.is_zero().then_some(Solved {
        particular: rest.companion,
        free,
    })
}

/// Bit fields packed into one vector, the first lowest, each value cut to its width.
pub(crate) fn bit_fields(fields: &[(u64, usize)]) -> Bits {
    let mut packed = Bits::zero();
    let mut at = 0;
    for &(value, width) in fields {
        packed.put(at, width, value);
        at += width;
    }
    packed
}

/// The `count` unit vectors, bit i alone in the i-th.
pub(crate) fn unit_vectors(count: usize) -> Vec<Bits> {
    (0..count).map(Bits::unit).collect()
}

/// An affine `map` at `origin`, and its change along each of `directions`: its value and the
/// columns of its equations.
pub(crate) fn linearize(
    map: &mut dyn FnMut(&Bits) -> Bits,
    origin: &Bits,
    directions: &[Bits],
) -> (Bits, Vec<Bits>) {
    let value = map(origin);
    let columns = directions
        .iter()
        .map(|direction| map(&origin.xor(direction)).xor(&value))
        .collect();
    (value, columns)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bits_move_and_combine() {
        let mut bits = Bits::of(0b1011, 4);
        assert_eq!(bits.top_bit(), Some(3));
        bits.set(130);
        assert_eq!(bits.top_bit(), Some(130));
        assert_eq!(bits.field(0, 4), 0b1011);
        assert_eq!(bits.shifted_up(2).field(2, 4), 0b1011);
        assert!(bits.xor(&bits).is_zero());
        assert_eq!(Bits::ones(70).field(60, 10), 0x3ff);
        assert_eq!(bit_fields(&[(0xff, 4), (1, 2)]).field(0, 8), 0b01_1111);
    }

    #[test]
    fn a_system_is_solved_with_its_free_directions() {
        // x0 + x1 = 1, x1 = 1; x2 free.
        let columns = [Bits::of(0b01, 2), Bits::of(0b11, 2), Bits::zero()];
        let solved = solve(&columns, &Bits::of(0b11, 2)).unwrap();
        assert_eq!(solved.particular.field(0, 3), 0b010);
        assert_eq!(solved.free.len(), 1);
        assert_eq!(solved.free[0].field(0, 3), 0b100);
        assert!(solve(&[Bits::zero()], &Bits::unit(0)).is_none());
    }
}
