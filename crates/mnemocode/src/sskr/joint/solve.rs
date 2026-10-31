//! The solution of marked shares of one set together (MnemoCode TS 0.1.0's
//! `src/sskr/joint-solve.ts`): one reading of every share ([`Joint`]), its equations over GF(2)
//! with those of the set and its polynomial, and each solved way to read the shares ([`Branch`]),
//! whose open bits the 32-bit digest decides.

use std::rc::Rc;

use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

use super::super::gf2::{
    Bits, PivotBasis, Solved, bit_fields, combination, linearize, solve, unit_vectors,
};
use super::super::gf256::{DIGEST_X, SECRET_X, lagrange_coefficients, multiply};
use super::super::repair::reading::ReadingSpace;
use super::super::restore::{MarkedElement, RestoreError, SetShare, restore_complete};
use super::super::set::MIN_DIGEST_THRESHOLD;
use super::super::share::{
    GROUP_BYTE, MEMBER_BYTE, MEMBER_THRESHOLD_BYTE, NIBBLE_BITS, NIBBLE_MASK, SHARE_METADATA_BYTES,
    Share,
};
use crate::bip39::phrase::Phrase;
use crate::secret::SecretBytes;

/// The digest bits that bc-shamir compares.
pub(crate) const DIGEST_BITS: usize = 32;
const DIGEST_BYTES: usize = DIGEST_BITS / 8;
/// Unsettled bits of the thresholds and member numbers, which [`MAX_BRANCHES`] follows from.
const MAX_LABEL_BITS: usize = 12;
/// Ways to read the shares that are solved before refusing.
pub(crate) const MAX_BRANCHES: usize = 1 << MAX_LABEL_BITS;
/// Values of undetermined elements tried until the shares read; they do not change the phrase.
const MAX_HIDDEN_TRIES_BITS: usize = 8;

/// One reading of every share, and their joint coordinates: bit `offsets[s] + j` is basis vector j
/// of share s.
#[derive(Clone, Debug)]
pub(crate) struct Joint {
    spaces: Vec<Rc<ReadingSpace>>,
    offsets: Vec<usize>,
    secret_bytes: usize,
}

impl Joint {
    /// The coordinates of `spaces`, one reading of each share in order, all of a secret of
    /// `secret_bytes` bytes.
    pub(crate) fn new(spaces: Vec<Rc<ReadingSpace>>, secret_bytes: usize) -> Self {
        let mut offsets = Vec::with_capacity(spaces.len());
        let mut sum = 0;
        for space in &spaces {
            offsets.push(sum);
            sum += space.basis().len();
        }
        Self {
            spaces,
            offsets,
            secret_bytes,
        }
    }

    /// The reading of each share.
    pub(crate) fn spaces(&self) -> &[Rc<ReadingSpace>] {
        &self.spaces
    }

    /// The joint coordinates: every basis vector of every share.
    fn dimensions(&self) -> usize {
        self.spaces.iter().map(|space| space.basis().len()).sum()
    }

    /// The bits of joint point `z` that pick share `share`'s basis vectors.
    fn own(&self, share: usize, z: &Bits) -> Bits {
        z.shifted_down(self.offsets[share])
    }

    /// The change joint direction `z` makes to the marked bits of share `share`.
    pub(crate) fn hole_change(&self, share: usize, z: &Bits) -> Bits {
        combination(self.spaces[share].basis(), &self.own(share, z))
    }

    /// Every share's payload at joint point `z`.
    fn payloads_at(&self, z: &Bits) -> Vec<SecretBytes> {
        self.spaces
            .iter()
            .enumerate()
            .map(|(share, space)| space.payload_at(&self.own(share, z)))
            .collect()
    }
}

/// Rows that hold for every reading of a set of one group: one group, and the same metadata.
fn shared_residual(payloads: &[SecretBytes]) -> Bits {
    let first = &payloads[0];
    let mut fields = vec![
        (u64::from(first[GROUP_BYTE]), 8),
        (
            u64::from(first[MEMBER_THRESHOLD_BYTE] >> NIBBLE_BITS),
            NIBBLE_BITS,
        ),
    ];
    for payload in &payloads[1..] {
        for byte in 0..MEMBER_BYTE {
            fields.push((u64::from(payload[byte] ^ first[byte]), 8));
        }
    }
    bit_fields(&fields)
}

/// The member threshold, less one, then the member number of every share, 4 bits each.
fn labels_of(payloads: &[SecretBytes]) -> Bits {
    let mut fields = vec![(
        u64::from(payloads[0][MEMBER_THRESHOLD_BYTE] & NIBBLE_MASK),
        NIBBLE_BITS,
    )];
    fields.extend(
        payloads
            .iter()
            .map(|payload| (u64::from(payload[MEMBER_BYTE] & NIBBLE_MASK), NIBBLE_BITS)),
    );
    bit_fields(&fields)
}

/// Every share beyond the base is a copy of a base share or lies on the base's polynomial.
fn polynomial_residual(
    payloads: &[SecretBytes],
    members: &[u8],
    base: &[usize],
    secret_bytes: usize,
) -> Bits {
    let xs: Vec<u8> = base.iter().map(|&share| members[share]).collect();
    let mut fields = Vec::new();
    for (share, payload) in payloads.iter().enumerate() {
        if base.contains(&share) {
            continue;
        }
        let copy_of = base
            .iter()
            .copied()
            .find(|&other| members[other] == members[share]);
        let lambdas = match copy_of {
            Some(_) => Vec::new(),
            None => lagrange_coefficients(&xs, members[share]),
        };
        for k in SHARE_METADATA_BYTES..SHARE_METADATA_BYTES + secret_bytes {
            let mut value = payload[k];
            match copy_of {
                Some(other) => value ^= payloads[other][k],
                None => {
                    for (i, &other) in base.iter().enumerate() {
                        value ^= multiply(lambdas[i], payloads[other][k]);
                    }
                }
            }
            fields.push((u64::from(value), 8));
        }
    }
    bit_fields(&fields)
}

/// The secret S and the digest share D of the base's polynomial, S then D.
fn secret_and_digest(
    payloads: &[SecretBytes],
    members: &[u8],
    base: &[usize],
    secret_bytes: usize,
) -> SecretBytes {
    let xs: Vec<u8> = base.iter().map(|&share| members[share]).collect();
    let to_secret = lagrange_coefficients(&xs, SECRET_X);
    let to_digest = lagrange_coefficients(&xs, DIGEST_X);
    let mut out = SecretBytes::zeroed("a secret and its digest", 2 * secret_bytes);
    for k in 0..secret_bytes {
        for (i, &share) in base.iter().enumerate() {
            let y = payloads[share][SHARE_METADATA_BYTES + k];
            out[k] ^= multiply(to_secret[i], y);
            out[secret_bytes + k] ^= multiply(to_digest[i], y);
        }
    }
    out
}

/// bc-shamir's check: HMAC-SHA256 keyed by D[4..] over S begins with D[0..4].
pub(crate) fn digest_fits(secret_and_digest: &[u8], secret_bytes: usize) -> bool {
    let (secret, digest) = secret_and_digest.split_at(secret_bytes);
    let Ok(mut mac) = <Hmac<Sha256> as KeyInit>::new_from_slice(&digest[DIGEST_BYTES..]) else {
        return false;
    };
    mac.update(secret);
    let code = mac.finalize().into_bytes();
    code[..DIGEST_BYTES] == digest[..DIGEST_BYTES]
}

/// A basis of the span of `vectors`.
fn basis_of(vectors: &[Bits]) -> Vec<Bits> {
    let mut basis = PivotBasis::default();
    for vector in vectors {
        basis.add(vector, &Bits::zero());
    }
    basis.vectors()
}

/// The first `threshold` shares with distinct members; none when there are fewer.
fn base_of(members: &[u8], threshold: usize) -> Option<Vec<usize>> {
    let mut base: Vec<usize> = Vec::new();
    for share in 0..members.len() {
        if base.len() == threshold {
            break;
        }
        if !base.iter().any(|&other| members[other] == members[share]) {
            base.push(share);
        }
    }
    (base.len() == threshold).then_some(base)
}

/// A solved way to read the shares: a threshold, a member number for each share, and the affine
/// space of the joint points that fit them, split into the directions the digest decides
/// (visible) and those it does not (hidden).
#[derive(Debug)]
pub(crate) struct Branch {
    joint: Joint,
    threshold: usize,
    members: Vec<u8>,
    particular: Bits,
    visible: Vec<Bits>,
    visible_deltas: Vec<SecretBytes>,
    hidden: Vec<Bits>,
    secret_and_digest: SecretBytes,
}

/// What solving readings of the shares tells of the ways to read them.
#[derive(Debug, Default)]
pub(crate) struct SolvedWays {
    /// Each way that fits.
    pub(crate) branches: Vec<Branch>,
    /// Some reading fits as far as its shares go, but no possibility has as many distinct members
    /// as its threshold: more shares may settle it.
    pub(crate) needs_more: bool,
    /// Some possibility gave two shares the same member number.
    pub(crate) duplicates: bool,
    /// The thresholds and member numbers leave too many possibilities to solve each.
    pub(crate) too_many: bool,
}

impl SolvedWays {
    /// These ways with `more`'s.
    pub(crate) fn with(mut self, more: Self) -> Self {
        self.branches.extend(more.branches);
        self.needs_more |= more.needs_more;
        self.duplicates |= more.duplicates;
        self
    }
}

/// Splits `directions` by whether they change (S, D); a hidden one is reduced so it changes none.
fn split_by_digest(
    directions: &[Bits],
    sd_at: &dyn Fn(&Bits) -> SecretBytes,
    origin: &Bits,
) -> (Vec<Bits>, Vec<SecretBytes>, Vec<Bits>) {
    let sd0 = sd_at(origin);
    let delta_of = |direction: &Bits| {
        let mut delta = sd_at(&origin.xor(direction));
        for (byte, base) in delta.iter_mut().zip(sd0.iter()) {
            *byte ^= base;
        }
        delta
    };
    let mut images = PivotBasis::default();
    let (mut visible, mut deltas, mut hidden) = (Vec::new(), Vec::new(), Vec::new());
    for original in directions {
        let reduced = images.add(&Bits::of_bytes(&delta_of(original)), original);
        if reduced.vector.is_zero() {
            hidden.push(reduced.companion);
        } else {
            deltas.push(delta_of(&reduced.companion));
            visible.push(reduced.companion);
        }
    }
    (visible, deltas, hidden)
}

/// The work a [`LabelWalk`] may still do for the choices of thresholds and member numbers: payload
/// evaluations, about a microsecond each.
#[derive(Debug)]
pub(crate) struct WorkBudget {
    /// The evaluations still allowed.
    pub(crate) left: u64,
}

/// The choices of thresholds and member numbers that the rows of a reading leave.
#[derive(Debug)]
struct Labels {
    common: Solved,
    value: Bits,
    basis: Vec<Bits>,
    next: u64,
    enough_members: bool,
}

/// One reading of every share, solved a piece at a time, so that the host can stop an assessment:
/// first the rows every reading shares, then, for each threshold and set of member numbers those
/// leave possible, the polynomial.
#[derive(Debug)]
pub(crate) struct LabelWalk {
    joint: Joint,
    ways: SolvedWays,
    labels: Option<Labels>,
}

impl LabelWalk {
    /// The walk of `joint`, the rows every reading shares solved, within `budget`.
    pub(crate) fn new(joint: Joint, budget: Option<&mut WorkBudget>) -> Self {
        let (shared_value, shared_columns) = linearize(
            &mut |z| shared_residual(&joint.payloads_at(z)),
            &Bits::zero(),
            &unit_vectors(joint.dimensions()),
        );
        // Another set, or a misread element: the reading does not fit.
        let Some(common) = solve(&shared_columns, &shared_value) else {
            return Self {
                joint,
                ways: SolvedWays::default(),
                labels: None,
            };
        };
        let (value, label_columns) = linearize(
            &mut |z| labels_of(&joint.payloads_at(z)),
            &common.particular,
            &common.free,
        );
        let basis = basis_of(&label_columns);
        let work = (1_u64 << basis.len().min(u64::BITS as usize - 1))
            .saturating_mul(common.free.len() as u64 + 1)
            .saturating_mul(joint.spaces.len() as u64);
        let refused = basis.len() > MAX_LABEL_BITS
            || budget.as_ref().is_some_and(|budget| work > budget.left);
        if refused {
            return Self {
                joint,
                ways: SolvedWays {
                    too_many: true,
                    ..SolvedWays::default()
                },
                labels: None,
            };
        }
        if let Some(budget) = budget {
            budget.left -= work;
        }
        Self {
            joint,
            ways: SolvedWays::default(),
            labels: Some(Labels {
                common,
                value,
                basis,
                next: 0,
                enough_members: false,
            }),
        }
    }

    /// Solves the next choice; whether any is left.
    pub(crate) fn step(&mut self) -> bool {
        let Some(labels) = &mut self.labels else {
            return false;
        };
        if labels.next == 1_u64 << labels.basis.len() {
            self.ways.needs_more = !labels.enough_members;
            self.labels = None;
            return false;
        }
        let choice = labels.next;
        labels.next += 1;
        let joint = &self.joint;
        let label = labels.value.xor(&combination(
            &labels.basis,
            &Bits::of(choice, labels.basis.len()),
        ));
        let threshold = label.field(0, NIBBLE_BITS) as usize + 1;
        let shares = joint.spaces.len();
        let members: Vec<u8> = (0..shares)
            .map(|share| label.field(NIBBLE_BITS * (share + 1), NIBBLE_BITS) as u8)
            .collect();
        let mut distinct = members.clone();
        distinct.sort_unstable();
        distinct.dedup();
        self.ways.duplicates |= distinct.len() < shares;
        // A threshold of 1 keeps no digest, so nothing would be checked.
        let Some(base) = (threshold >= MIN_DIGEST_THRESHOLD)
            .then(|| base_of(&members, threshold))
            .flatten()
        else {
            return true;
        };
        labels.enough_members = true;
        let common = &labels.common;
        let (local_value, local_columns) = linearize(
            &mut |z| {
                let payloads = joint.payloads_at(z);
                labels_of(&payloads).xor(&label).xor(
                    &polynomial_residual(&payloads, &members, &base, joint.secret_bytes)
                        .shifted_up(NIBBLE_BITS * (shares + 1)),
                )
            },
            &common.particular,
            &common.free,
        );
        let Some(solved) = solve(&local_columns, &local_value) else {
            return true;
        };
        let particular = common
            .particular
            .xor(&combination(&common.free, &solved.particular));
        let free: Vec<Bits> = solved
            .free
            .iter()
            .map(|direction| combination(&common.free, direction))
            .collect();
        let sd_at = |z: &Bits| {
            secret_and_digest(&joint.payloads_at(z), &members, &base, joint.secret_bytes)
        };
        let (visible, visible_deltas, hidden) = split_by_digest(&free, &sd_at, &particular);
        let secret_and_digest = sd_at(&particular);
        self.ways.branches.push(Branch {
            joint: joint.clone(),
            threshold,
            members,
            particular,
            visible,
            visible_deltas,
            hidden,
            secret_and_digest,
        });
        true
    }

    /// The ways found.
    pub(crate) fn finish(self) -> SolvedWays {
        self.ways
    }
}

/// Whether the shares plainly belong to a set of several groups: the group byte is set in every
/// reading.
pub(crate) fn several_groups(spaces: &[Rc<ReadingSpace>]) -> bool {
    spaces.iter().all(|space| {
        space
            .fixed_payload_byte(GROUP_BYTE)
            .is_some_and(|groups| groups != 0)
    })
}

/// An element whose reading would leave fewer open bits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ElementHelp {
    /// The element: its share and place, both from 1.
    pub element: MarkedElement,
    /// Bits left open with this element read.
    pub open_bits: usize,
}

/// A phrase restored, the places of the shares that took no part, and whether a digest checked it.
type Restored = (Phrase, Vec<usize>, bool);

/// Restores the phrase from the shares read, each copy once, every surplus member checked: the
/// phrase, the places among the shares read, from 0, of those that took no part, and whether a
/// digest checked it; none when they do not restore one phrase, and any other failure passes on.
fn restore(shares: &[SetShare]) -> Result<Option<Restored>, RestoreError> {
    let mut kept: Vec<usize> = Vec::new();
    for (place, share) in shares.iter().enumerate() {
        if !kept
            .iter()
            .any(|&other| shares[other].share.payload() == share.share.payload())
        {
            kept.push(place);
        }
    }
    let read: Vec<&Share> = kept.iter().map(|&place| &shares[place].share).collect();
    let restored = match restore_complete(&read, None) {
        Ok(restored) => restored,
        Err(error) if error.refuses_shares() => return Ok(None),
        Err(error) => return Err(error),
    };
    let unchecked = restored
        .unchecked
        .iter()
        .map(|&index| kept[index])
        .collect();
    Ok(Some((restored.phrase, unchecked, restored.digest_checked)))
}

/// A phrase a candidate restores, with every share as read and what is left unsettled.
#[derive(Debug)]
pub(crate) struct Candidate {
    /// The phrase.
    pub(crate) phrase: Phrase,
    /// Every share, in the order given, as repaired.
    pub(crate) shares: Vec<SetShare>,
    /// Elements that a hidden direction changes.
    pub(crate) unsettled: Vec<MarkedElement>,
    /// The shares, from 0, that took no part.
    pub(crate) unchecked: Vec<usize>,
    /// Whether a digest checked the phrase.
    pub(crate) digest_checked: bool,
}

impl Branch {
    /// The member threshold of this way to read the shares.
    pub(crate) const fn threshold(&self) -> usize {
        self.threshold
    }

    /// The bytes of the secret.
    pub(crate) const fn secret_bytes(&self) -> usize {
        self.joint.secret_bytes
    }

    /// Bits only the digest can decide.
    pub(crate) fn open_bits(&self) -> usize {
        self.visible.len()
    }

    /// The readings it was solved from.
    pub(crate) fn spaces(&self) -> &[Rc<ReadingSpace>] {
        self.joint.spaces()
    }

    /// The (S, D) of the search's first point.
    pub(crate) const fn first_secret_and_digest(&self) -> &SecretBytes {
        &self.secret_and_digest
    }

    /// The change to (S, D) of visible direction `index`.
    pub(crate) fn visible_delta(&self, index: usize) -> &[u8] {
        &self.visible_deltas[index]
    }

    /// The joint point of step `step` of the search, in Gray code order.
    pub(crate) fn point_at(&self, step: u64) -> Bits {
        let gray = step ^ (step >> 1);
        self.particular.xor(&combination(
            &self.visible,
            &Bits::of(gray, self.visible.len()),
        ))
    }

    /// Open bits of this branch if marked unit `hole` (its order among the holes) of share
    /// `share` were read.
    pub(crate) fn open_bits_if_read(&self, share: usize, hole: usize) -> usize {
        let mask = self.joint.spaces[share].unit_mask(hole);
        let mut parts = PivotBasis::default();
        let mut kept = Vec::new();
        let directions = self
            .visible
            .iter()
            .zip(&self.visible_deltas)
            .map(|(direction, delta)| (direction, Bits::of_bytes(delta)))
            .chain(
                self.hidden
                    .iter()
                    .map(|direction| (direction, Bits::zero())),
            );
        for (direction, image) in directions {
            let reduced = parts.add(&self.joint.hole_change(share, direction).and(&mask), &image);
            if reduced.vector.is_zero() {
                kept.push(reduced.companion);
            }
        }
        basis_of(&kept).len()
    }

    /// About how many more shares would settle what this branch leaves open.
    pub(crate) fn shares_to_settle(&self, marks: &[usize]) -> usize {
        if self.open_bits() == 0 {
            return 0;
        }
        let mut clean: Vec<u8> = self
            .members
            .iter()
            .zip(marks)
            .filter(|&(_, &marks)| marks == 0)
            .map(|(&member, _)| member)
            .collect();
        clean.sort_unstable();
        clean.dedup();
        let by_equations = self.open_bits().div_ceil(8 * self.secret_bytes());
        self.threshold
            .saturating_sub(clean.len())
            .min(by_equations)
            .max(1)
    }

    /// Elements that a hidden direction changes.
    fn unsettled_elements(&self) -> Vec<MarkedElement> {
        self.joint
            .spaces
            .iter()
            .enumerate()
            .flat_map(|(share, space)| {
                let changed = self.hidden.iter().fold(Bits::zero(), |bits, direction| {
                    bits.or(&self.joint.hole_change(share, direction))
                });
                space
                    .holes_changed_by(&changed)
                    .into_iter()
                    .map(move |place| MarkedElement {
                        share: share + 1,
                        position: place + 1,
                    })
            })
            .collect()
    }

    /// Every share at joint point `z`, read as an ordinary share; none if one does not read.
    fn read_candidate(&self, z: &Bits) -> Option<Vec<SetShare>> {
        self.joint
            .spaces
            .iter()
            .enumerate()
            .map(|(share, space)| {
                let values =
                    space.values_at(&space.particular().xor(&self.joint.hole_change(share, z)));
                space.reading().solved_share(&values)
            })
            .collect()
    }

    /// Reads the shares of a candidate that passed the digest and restores the phrase. The first
    /// values of the undetermined elements with which every share reads are taken; they do not
    /// change the phrase and are reported unsettled.
    pub(crate) fn confirm(&self, z: &Bits) -> Result<Option<Candidate>, RestoreError> {
        let hidden_bits = self.hidden.len().min(MAX_HIDDEN_TRIES_BITS);
        for choice in 0..1_u64 << hidden_bits {
            let point = z.xor(&combination(&self.hidden, &Bits::of(choice, hidden_bits)));
            let Some(shares) = self.read_candidate(&point) else {
                continue;
            };
            let Some((phrase, unchecked, digest_checked)) = restore(&shares)? else {
                return Ok(None);
            };
            return Ok(Some(Candidate {
                phrase,
                shares,
                unsettled: self.unsettled_elements(),
                unchecked,
                digest_checked,
            }));
        }
        Ok(None)
    }
}

/// The branch with the most open bits, which decides the time of the search: the first of them.
pub(crate) fn widest_branch(branches: &[Branch]) -> Option<&Branch> {
    branches.iter().reduce(|most, branch| {
        if branch.open_bits() > most.open_bits() {
            branch
        } else {
            most
        }
    })
}

/// The elements of share `share` of `widest` whose reading would leave fewer open bits.
pub(crate) fn helpful_elements_of(widest: &Branch, share: usize) -> Vec<ElementHelp> {
    let open_bits = widest.open_bits();
    let space = &widest.spaces()[share];
    space
        .holes()
        .iter()
        .enumerate()
        .map(|(hole, &place)| ElementHelp {
            element: MarkedElement {
                share: share + 1,
                position: place + 1,
            },
            open_bits: widest.open_bits_if_read(share, hole),
        })
        .filter(|help| help.open_bits < open_bits)
        .collect()
}
