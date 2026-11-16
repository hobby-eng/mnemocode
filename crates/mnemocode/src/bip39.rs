//! BIP39, as MnemoCode uses it: the sizes of phrases, the word table and its numbered dictionaries,
//! phrases checked once, and the seed. The words, the checksum, the entropy and the seed are the
//! bip39 crate's 3.0.0, with no BIP39 code of our own; the tokens, the counts, the places of words
//! and the refusals are MnemoCode's, as TS 0.1.0 writes them.

pub mod phrase;
pub mod seed;
pub mod sizes;
pub mod table;
