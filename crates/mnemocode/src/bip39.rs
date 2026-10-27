//! BIP39, as MnemoCode uses it: the sizes of phrases, the word table and its numbered
//! dictionaries, phrases checked once, and the seed. The words, the checksum, the entropy and the
//! seed are the bip39 crate's 3.0.0 (owner, 2026-10-27: no own BIP39 code); the tokens, the counts,
//! the places of words and the refusals are MnemoCode's, word for word as TS 0.1.0 writes them.

pub mod phrase;
pub mod seed;
pub mod sizes;
pub mod table;
