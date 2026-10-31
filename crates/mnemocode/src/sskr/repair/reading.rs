//! One way to read a marked share and its solutions (MnemoCode TS 0.1.0's
//! `src/sskr/repair-owners.ts`): a reading holds the units of one form, the structure of the
//! share's bytes it is solved in, and what a solution must fit; its space is every assignment of
//! the marked bits that makes the share well formed, one solution and the directions between them.

use std::fmt;

use super::super::forms::{ShareFormat, read_share};
use super::super::gf2::{Bits, bit_fields, linearize, solve, unit_vectors};
use super::super::marks::{AmbiguousMarks, CodeConstraints, ReadBits, ReadingUnits, unit_models};
use super::super::restore::{FilledElement, SetShare};
use super::super::share::SHARE_METADATA_BYTES;
use super::units::Structure;
use crate::secret::{SecretBytes, SecretText};
use crate::text::codes::{fits_pattern, whole_mark};

/// Every way to pick one item of each list, the first list varying slowest; none above `limit`.
pub(crate) fn every_pick<T: Clone>(lists: &[Vec<T>], limit: usize) -> Option<Vec<Vec<T>>> {
    let mut all: Vec<Vec<T>> = vec![Vec::new()];
    for list in lists {
        if !list.is_empty() && all.len() > limit / list.len() {
            return None;
        }
        all = all
            .iter()
            .flat_map(|prefix| {
                list.iter().map(move |item| {
                    let mut picked = prefix.clone();
                    picked.push(item.clone());
                    picked
                })
            })
            .collect();
    }
    Some(all)
}

/// A reading of a marked share: its units in one form and the structure it is solved in.
#[derive(Clone)]
pub(crate) struct MarkedReading {
    units: ReadingUnits,
    structure: Structure,
    /// The marked units' places, from 0, in their bit order.
    holes: Vec<usize>,
}

impl fmt::Debug for MarkedReading {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "a marked reading")
    }
}

impl MarkedReading {
    fn new(units: ReadingUnits, structure: Structure) -> Self {
        let holes = units
            .values
            .iter()
            .enumerate()
            .filter_map(|(place, value)| value.is_none().then_some(place))
            .collect();
        Self {
            units,
            structure,
            holes,
        }
    }

    /// Every reading of `text`: each way to read it in each form, in each structure.
    pub(crate) fn of(text: &str) -> Result<Vec<Self>, AmbiguousMarks> {
        Ok(unit_models(text)?
            .into_iter()
            .flat_map(|model| {
                model
                    .structures
                    .into_iter()
                    .map(move |structure| Self::new(model.units.clone(), structure))
            })
            .collect())
    }

    /// The form it reads.
    pub(crate) const fn format(&self) -> ShareFormat {
        self.units.format
    }

    /// Whether complete decoy cards follow a supported prefix.
    pub(crate) const fn with_decoys(&self) -> bool {
        self.units.decoys
    }

    /// The bits of one unit.
    pub(crate) const fn unit_bits(&self) -> usize {
        self.units.format.unit_bits()
    }

    /// The structure it is solved in.
    pub(crate) const fn structure(&self) -> &Structure {
        &self.structure
    }

    /// The marked units' places, from 0.
    pub(crate) fn holes(&self) -> &[usize] {
        &self.holes
    }

    /// The number of unknown bits.
    pub(crate) fn unknown_bits(&self) -> usize {
        self.holes.len() * self.unit_bits()
    }

    /// The bit mask of marked unit `order`, from 0 among the holes.
    pub(crate) fn unit_mask(&self, order: usize) -> Bits {
        Bits::ones(self.unit_bits()).shifted_up(order * self.unit_bits())
    }

    /// The unit values with `bits` at the marks.
    pub(crate) fn values_at(&self, bits: &Bits) -> Vec<u32> {
        let mut values: Vec<u32> = self
            .units
            .values
            .iter()
            .map(|value| value.unwrap_or(0))
            .collect();
        let width = self.unit_bits();
        for (order, &hole) in self.holes.iter().enumerate() {
            values[hole] = bits.field(order * width, width) as u32;
        }
        values
    }

    /// A reading with `chosen` unit values added as bits read in full.
    fn with_values(&self, chosen: &[(usize, u32)]) -> Self {
        let mask = (1 << self.unit_bits()) - 1;
        let mut units = self.units.clone();
        let read_bits = (0..units.values.len())
            .map(|place| match chosen.iter().find(|(at, _)| *at == place) {
                Some(&(_, value)) => Some(ReadBits { value, mask }),
                None => self
                    .units
                    .read_bits
                    .as_ref()
                    .and_then(|bits| bits.get(place).copied().flatten()),
            })
            .collect();
        units.read_bits = Some(read_bits);
        Self::new(units, self.structure)
    }

    /// Whether changing unit `place`, from 0, reaches the share's metadata bytes.
    pub(crate) fn reaches_metadata(&self, place: usize) -> bool {
        let values = self.values_at(&Bits::zero());
        let (_, before) = self.structure.evaluate(&values);
        (0..self.unit_bits()).any(|bit| {
            let mut flipped = values.clone();
            flipped[place] ^= 1 << bit;
            let (_, after) = self.structure.evaluate(&flipped);
            after[..SHARE_METADATA_BYTES] != before[..SHARE_METADATA_BYTES]
        })
    }

    /// The readings of every choice of candidates at `places`; a copy of this one without any.
    pub(crate) fn choices_at(&self, places: &[usize]) -> Vec<Self> {
        let candidates = self.units.candidates.as_ref();
        let tried: Vec<usize> = places
            .iter()
            .copied()
            .filter(|&place| {
                candidates.is_some_and(|lists| lists.get(place).is_some_and(Option::is_some))
            })
            .collect();
        let Some(candidates) = candidates.filter(|_| !tried.is_empty()) else {
            return vec![self.clone()];
        };
        let lists: Vec<Vec<u32>> = tried
            .iter()
            .map(|&place| candidates[place].clone().unwrap_or_default())
            .collect();
        every_pick(&lists, usize::MAX)
            .unwrap_or_default()
            .into_iter()
            .map(|values| {
                let chosen: Vec<(usize, u32)> = tried.iter().copied().zip(values).collect();
                self.with_values(&chosen)
            })
            .collect()
    }

    /// The candidate units' places, from 0, and the number of values of each.
    pub(crate) fn candidate_counts(&self) -> Vec<(usize, usize)> {
        self.units
            .candidates
            .iter()
            .flatten()
            .enumerate()
            .filter_map(|(place, values)| values.as_ref().map(|values| (place, values.len())))
            .collect()
    }

    /// Whether `values` fit the candidates and the codes read.
    fn fits(&self, values: &[u32]) -> bool {
        if let Some(candidates) = &self.units.candidates
            && !candidates
                .iter()
                .zip(values)
                .all(|(allowed, value)| allowed.as_ref().is_none_or(|list| list.contains(value)))
        {
            return false;
        }
        let Some(CodeConstraints { pairs, prefix }) = &self.units.code_constraints else {
            return true;
        };
        let checked = if *prefix {
            &pairs[..pairs.len().min(values.len())]
        } else {
            &pairs[..]
        };
        checked.iter().enumerate().all(|(index, pair)| {
            let written = self.units.format.unit_text(values[index]);
            let codes: Vec<&str> = (0..written.len() / 4)
                .map(|half| &written[half * 4..half * 4 + 4])
                .collect();
            pair.iter().enumerate().all(|(half, code)| {
                let at = codes.get(half).copied().unwrap_or_default();
                if *prefix {
                    whole_mark(code) || fits_pattern(code, at)
                } else {
                    code == "?" || code == at
                }
            })
        })
    }

    /// The share `values` make, when they fit the reading and the ordinary reader reads them in
    /// its form; with the marked elements as filled.
    pub(crate) fn solved_share(&self, values: &[u32]) -> Option<SetShare> {
        if !self.fits(values) {
            return None;
        }
        let format = self.units.format;
        let read = read_share(&format.units_written(values)).ok()?;
        if read.format != format {
            return None;
        }
        let filled = self
            .holes
            .iter()
            .map(|&index| FilledElement {
                position: index + 1,
                value: SecretText::copy_of("a filled element", &format.unit_text(values[index])),
            })
            .collect();
        Some(SetShare {
            share: read.share,
            format,
            filled,
        })
    }

    /// Its space of solutions; none when no values fit.
    pub(crate) fn space(&self) -> Option<ReadingSpace> {
        ReadingSpace::solve(self)
    }
}

/// The solutions of a reading: one, the directions between them, and the payload of each.
pub(crate) struct ReadingSpace {
    reading: MarkedReading,
    particular: Bits,
    basis: Vec<Bits>,
    payload: SecretBytes,
    payload_deltas: Vec<SecretBytes>,
}

impl fmt::Debug for ReadingSpace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "a reading's solutions")
    }
}

impl ReadingSpace {
    /// The residual and the payload of `reading` with `bits` at its marks: the structure's, with
    /// the bits read of partly read units as equations of their own.
    fn at(reading: &MarkedReading, bits: &Bits) -> (Bits, SecretBytes) {
        let values = reading.values_at(bits);
        let (residual, payload) = reading.structure.evaluate(&values);
        let Some(read_bits) = &reading.units.read_bits else {
            return (residual, payload);
        };
        let read = bit_fields(
            &reading
                .holes
                .iter()
                .map(|&hole| {
                    let change = read_bits
                        .get(hole)
                        .copied()
                        .flatten()
                        .map_or(0, |bits| (values[hole] ^ bits.value) & bits.mask);
                    (u64::from(change), reading.unit_bits())
                })
                .collect::<Vec<_>>(),
        );
        (
            residual.shifted_up(reading.unknown_bits()).xor(&read),
            payload,
        )
    }

    /// Solves `input` into a space of its own; none when no values fit.
    pub(crate) fn solve(input: &MarkedReading) -> Option<Self> {
        let reading = input.clone();
        let (baseline, columns) = linearize(
            &mut |bits| Self::at(&reading, bits).0,
            &Bits::zero(),
            &unit_vectors(reading.unknown_bits()),
        );
        let solved = solve(&columns, &baseline)?;
        let (_, payload) = Self::at(&reading, &solved.particular);
        let payload_deltas = solved
            .free
            .iter()
            .map(|direction| {
                let (_, mut delta) = Self::at(&reading, &solved.particular.xor(direction));
                for (byte, base) in delta.iter_mut().zip(payload.iter()) {
                    *byte ^= base;
                }
                delta
            })
            .collect();
        Some(Self {
            reading,
            particular: solved.particular,
            basis: solved.free,
            payload,
            payload_deltas,
        })
    }

    /// Its reading.
    pub(crate) const fn reading(&self) -> &MarkedReading {
        &self.reading
    }

    /// One solution.
    pub(crate) const fn particular(&self) -> &Bits {
        &self.particular
    }

    /// The directions between solutions.
    pub(crate) fn basis(&self) -> &[Bits] {
        &self.basis
    }

    /// The marked units' places, from 0.
    pub(crate) fn holes(&self) -> &[usize] {
        self.reading.holes()
    }

    /// The mask of marked unit `order`.
    pub(crate) fn unit_mask(&self, order: usize) -> Bits {
        self.reading.unit_mask(order)
    }

    /// The unit values at `bits`.
    pub(crate) fn values_at(&self, bits: &Bits) -> Vec<u32> {
        self.reading.values_at(bits)
    }

    /// The marked units' places that `change` touches.
    pub(crate) fn holes_changed_by(&self, change: &Bits) -> Vec<usize> {
        self.holes()
            .iter()
            .enumerate()
            .filter(|(order, _)| !change.and(&self.unit_mask(*order)).is_zero())
            .map(|(_, &hole)| hole)
            .collect()
    }

    /// The payload at basis choice `own`, in a locked buffer.
    pub(crate) fn payload_at(&self, own: &Bits) -> SecretBytes {
        let mut payload = SecretBytes::copy_of("a share's payload", &self.payload);
        for (index, delta) in self.payload_deltas.iter().enumerate() {
            if own.bit(index) {
                for (byte, change) in payload.iter_mut().zip(delta.iter()) {
                    *byte ^= change;
                }
            }
        }
        payload
    }

    /// A payload byte no solution changes; none where one does.
    pub(crate) fn fixed_payload_byte(&self, index: usize) -> Option<u8> {
        self.payload_deltas
            .iter()
            .all(|delta| delta[index] == 0)
            .then(|| self.payload[index])
    }
}
