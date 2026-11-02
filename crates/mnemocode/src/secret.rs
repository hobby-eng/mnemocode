//! Secrets in memory (ADR 0003, RUST-13): owners that hold a secret in one buffer reserved at its
//! final size, locked before the secret is written into it where the system allows, never grown,
//! and wiped on drop; the zeroing allocator that every artifact registers, so that copies made by
//! dependencies and by the WebAssembly glue are wiped when they are freed; and the stack scrub that
//! the binding runs after each call that handled a secret.
//!
//! An owner prints itself only as `[<Label>: redacted]` (CAP-PHRASE-FORMATS-SECRET-OWNERS) and has
//! no `Display`. Domain owners (a phrase, entropy, a seed, a share) wrap these two and lend slices.

mod allocator;
mod pages;

use std::fmt;
use std::ops::{Deref, DerefMut};

use zeroize::Zeroize;

pub use allocator::ZeroingAllocator;
pub use pages::any_lock_refused;

use crate::refusal::Refusal;

/// The bytes of the stack that [`scrub_stack`] overwrites: more than the deepest stack measured
/// over the entries that handle a secret. TS measured 2,936 bytes for its SSKR engine and kept
/// 16 KiB (sskr-wasm/rust/src/lib.rs:22-25). The `wasm` gate measures every row of the self-check
/// on each build and refuses one that reaches this size (ARCHITECTURE.md §6). The deepest, the QR
/// reader, leaves data some 77 KiB down, so this keeps about two thirds more.
pub const STACK_SCRUB_BYTES: usize = 128 * 1024;

/// A secret did not fit the buffer reserved for it: the reserved size was computed too small.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CapacityExceeded;

impl fmt::Display for CapacityExceeded {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("A secret did not fit the memory reserved for it.")
    }
}

impl std::error::Error for CapacityExceeded {}

impl Refusal for CapacityExceeded {
    fn code(&self) -> &'static str {
        "core.secret.capacity-exceeded"
    }
}

/// Writes a secret into the buffer of a [`SecretBytes`] being built, never past its reserved size,
/// so that the buffer never moves and leaves no copy behind.
pub struct Filler<'a> {
    bytes: &'a mut Vec<u8>,
}

impl Filler<'_> {
    /// Appends `bytes`; refused, with nothing appended, when they do not fit.
    pub fn extend(&mut self, bytes: &[u8]) -> Result<(), CapacityExceeded> {
        if bytes.len() > self.remaining() {
            return Err(CapacityExceeded);
        }
        self.bytes.extend_from_slice(bytes);
        Ok(())
    }

    /// Appends one byte; refused when the buffer is full.
    pub fn push(&mut self, byte: u8) -> Result<(), CapacityExceeded> {
        self.extend(&[byte])
    }

    /// The bytes written so far, to read back while filling.
    pub fn written(&self) -> &[u8] {
        self.bytes
    }

    /// How many more bytes fit.
    pub fn remaining(&self) -> usize {
        self.bytes.capacity() - self.bytes.len()
    }
}

/// Bytes that are secret: entropy, a seed, a share, a typed line before it is read. The buffer is
/// reserved at its final size and locked before anything is written into it; the bytes may change
/// in place but never grow; on drop they are wiped, then the pages are unlocked.
pub struct SecretBytes {
    bytes: Vec<u8>,
    // Declared after `bytes`, so that the pages are unlocked only once the bytes are wiped and freed.
    locked: pages::LockedPages,
    label: &'static str,
}

impl SecretBytes {
    /// Bytes that `fill` writes into a buffer of `capacity` bytes, locked first. A `fill` that fails
    /// leaves what it wrote to be wiped here; it never writes past `capacity`.
    pub fn build<E>(
        label: &'static str,
        capacity: usize,
        fill: impl FnOnce(&mut Filler<'_>) -> Result<(), E>,
    ) -> Result<Self, E> {
        let bytes = Vec::with_capacity(capacity);
        let locked = pages::LockedPages::of(bytes.as_ptr(), bytes.capacity());
        let mut built = Self {
            bytes,
            locked,
            label,
        };
        fill(&mut Filler {
            bytes: &mut built.bytes,
        })?;
        Ok(built)
    }

    /// A copy of `bytes` in a buffer reserved at their size and locked before the copy is written.
    pub fn copy_of(label: &'static str, bytes: &[u8]) -> Self {
        let mut copy = Self::zeroed(label, bytes.len());
        copy.copy_from_slice(bytes);
        copy
    }

    /// Bytes too large for the lock budget, such as a drawn page: kept where they are and wiped on
    /// drop, never locked, so that the lock warning does not speak of them.
    pub fn large(label: &'static str, bytes: Vec<u8>) -> Self {
        let locked = pages::LockedPages::of(bytes.as_ptr(), 0);
        Self {
            bytes,
            locked,
            label,
        }
    }

    /// `length` zero bytes in a locked buffer, for a secret written in place afterwards.
    pub fn zeroed(label: &'static str, length: usize) -> Self {
        let mut bytes = Vec::with_capacity(length);
        let locked = pages::LockedPages::of(bytes.as_ptr(), bytes.capacity());
        bytes.resize(length, 0);
        Self {
            bytes,
            locked,
            label,
        }
    }

    /// Whether the operating system keeps these bytes out of swap.
    pub fn is_locked(&self) -> bool {
        self.locked.is_locked()
    }

    /// The label the owner prints instead of its bytes.
    pub fn label(&self) -> &'static str {
        self.label
    }
}

impl Deref for SecretBytes {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        &self.bytes
    }
}

impl DerefMut for SecretBytes {
    /// The bytes to change in place; as a slice they cannot grow out of their locked buffer.
    fn deref_mut(&mut self) -> &mut [u8] {
        &mut self.bytes
    }
}

impl Drop for SecretBytes {
    fn drop(&mut self) {
        // The whole capacity, the bytes past the length included.
        self.bytes.zeroize();
    }
}

impl fmt::Debug for SecretBytes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        redacted(f, self.label)
    }
}

/// Text that is secret: a phrase, a passphrase, codes, dates as typed. Valid UTF-8, held in a
/// [`SecretBytes`], so it is reserved, locked, never grown and wiped alike.
pub struct SecretText {
    bytes: SecretBytes,
}

impl SecretText {
    /// Text that `fill` writes into a buffer of `capacity` bytes, locked first.
    pub fn build<E>(
        label: &'static str,
        capacity: usize,
        fill: impl FnOnce(&mut TextFiller<'_, '_>) -> Result<(), E>,
    ) -> Result<Self, E> {
        let bytes = SecretBytes::build(label, capacity, |filler| fill(&mut TextFiller { filler }))?;
        Ok(Self { bytes })
    }

    /// A copy of `text` in a buffer reserved at its size and locked before the copy is written.
    pub fn copy_of(label: &'static str, text: &str) -> Self {
        Self {
            bytes: SecretBytes::copy_of(label, text.as_bytes()),
        }
    }

    /// The bytes as text, in the same buffer and under the same lock; bytes that are not UTF-8 come
    /// back as they are, to be wiped when dropped.
    pub fn from_bytes(bytes: SecretBytes) -> Result<Self, SecretBytes> {
        if std::str::from_utf8(&bytes).is_ok() {
            Ok(Self { bytes })
        } else {
            Err(bytes)
        }
    }

    /// The text.
    pub fn as_str(&self) -> &str {
        #[expect(
            clippy::expect_used,
            reason = "the bytes are checked as UTF-8 when the text is made and never change after"
        )]
        std::str::from_utf8(&self.bytes).expect("a secret text holds UTF-8")
    }

    /// Whether the operating system keeps the text out of swap.
    pub fn is_locked(&self) -> bool {
        self.bytes.is_locked()
    }
}

impl Deref for SecretText {
    type Target = str;

    fn deref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Debug for SecretText {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        redacted(f, self.bytes.label)
    }
}

/// Writes text into the buffer of a [`SecretText`] being built, never past its reserved size.
pub struct TextFiller<'a, 'b> {
    filler: &'a mut Filler<'b>,
}

impl TextFiller<'_, '_> {
    /// Appends `text`; refused, with nothing appended, when it does not fit.
    pub fn push_str(&mut self, text: &str) -> Result<(), CapacityExceeded> {
        self.filler.extend(text.as_bytes())
    }

    /// Appends one character; refused when it does not fit.
    pub fn push(&mut self, character: char) -> Result<(), CapacityExceeded> {
        let mut buffer = [0; 4];
        let encoded = character.encode_utf8(&mut buffer);
        let pushed = self.push_str(encoded);
        buffer.zeroize();
        pushed
    }

    /// How many more bytes fit.
    pub fn remaining(&self) -> usize {
        self.filler.remaining()
    }
}

/// Whether this process can keep `bytes` bytes of a secret out of swap: a buffer of that size is
/// locked and released, nothing written into it. The command line's lock row probes the buffer of
/// its longest answer with it, so that a pass speaks for that buffer, not a smaller one.
pub fn probe_lock(bytes: usize) -> bool {
    // Reserved and released here, nothing written into it; a refusal is not recorded as one of a
    // secret's.
    let probe: Vec<u8> = Vec::with_capacity(bytes);
    pages::LockedPages::probe(probe.as_ptr(), probe.capacity()).is_locked()
}

/// How every owner of a secret prints itself: `[<Label>: redacted]`.
pub fn redacted(f: &mut fmt::Formatter<'_>, label: &str) -> fmt::Result {
    write!(f, "[{label}: redacted]")
}

/// Whether `left` and `right` hold the same bytes. Every byte is read, without stopping at the
/// first difference, so that the time does not tell where secret bytes differ.
pub fn equal_bytes(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let different = left
        .iter()
        .zip(right)
        .fold(0_u8, |different, (a, b)| different | (a ^ b));
    std::hint::black_box(different) == 0
}

/// Overwrites [`STACK_SCRUB_BYTES`] of the stack below the caller, where the calls it made left
/// copies that their owners never wiped (the bip39 crate's PBKDF2 pads, HMAC states and returned
/// arrays), with zeroize's own `zeroize_stack`. Only what lies below the caller is reached: the
/// work must run in a function that is never inlined into it, as the binding's `after_secret`
/// runs it (ARCHITECTURE.md §6).
pub fn scrub_stack() {
    zeroize::zeroize_stack::<STACK_SCRUB_BYTES>();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_owner_prints_only_its_label() {
        let bytes = SecretBytes::copy_of("Seed", b"secret");
        let text = SecretText::copy_of("Phrase", "abandon about");
        assert_eq!(format!("{bytes:?}"), "[Seed: redacted]");
        assert_eq!(format!("{text:?}"), "[Phrase: redacted]");
    }

    #[test]
    fn a_built_secret_keeps_its_reserved_buffer() {
        let built = SecretBytes::build("Entropy", 4, |filler| {
            filler.extend(&[1, 2])?;
            filler.push(3)?;
            assert_eq!(filler.written(), [1, 2, 3]);
            assert_eq!(filler.remaining(), 1);
            Ok::<_, CapacityExceeded>(())
        })
        .unwrap();
        assert_eq!(&*built, [1, 2, 3]);
    }

    #[test]
    fn a_secret_past_its_reserved_size_is_refused() {
        let refused = SecretBytes::build("Entropy", 2, |filler| filler.extend(&[1, 2, 3]));
        let error = refused.err().unwrap();
        assert_eq!(error.code(), "core.secret.capacity-exceeded");
        assert_eq!(
            error.to_string(),
            "A secret did not fit the memory reserved for it."
        );
        let text = SecretText::build("Phrase", 3, |filler| {
            filler.push_str("ab")?;
            filler.push('\u{00e9}')
        });
        assert!(text.is_err());
    }

    #[test]
    fn text_is_taken_from_utf8_bytes_only() {
        let bytes = SecretBytes::copy_of("Line", "word".as_bytes());
        assert_eq!(SecretText::from_bytes(bytes).unwrap().as_str(), "word");
        let invalid = SecretBytes::copy_of("Line", &[0xff, 0xfe]);
        assert_eq!(&*SecretText::from_bytes(invalid).unwrap_err(), [0xff, 0xfe]);
    }

    #[test]
    fn equal_bytes_compares_length_and_content() {
        assert!(equal_bytes(b"abc", b"abc"));
        assert!(!equal_bytes(b"abc", b"abd"));
        assert!(!equal_bytes(b"abc", b"ab"));
        assert!(equal_bytes(b"", b""));
    }

    #[test]
    fn zeroed_bytes_have_their_length_and_change_in_place() {
        let mut bytes = SecretBytes::zeroed("Seed", 3);
        bytes[1] = 7;
        assert_eq!(&*bytes, [0, 7, 0]);
        assert_eq!(bytes.label(), "Seed");
    }

    #[test]
    fn an_empty_probe_locks_nothing_and_a_small_one_matches_a_secret() {
        assert!(!probe_lock(0));
        // A small buffer locks wherever the system grants RLIMIT_MEMLOCK at all; an administrator
        // or a container may set it to 0, and then neither locks.
        let secret = SecretBytes::zeroed("Probe", 64);
        assert_eq!(probe_lock(64), secret.is_locked());
    }
}
