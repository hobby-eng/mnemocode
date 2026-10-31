//! Shamir shares of a seed phrase's entropy (SSKR, BCR-2020-011): the engine that splits and
//! restores ([`engine`]), a share and its bytes ([`share`]), the forms it is written in
//! ([`forms`]), its text as a compact UR or standard Bytewords ([`text`]), the Bytewords
//! ([`bytewords`]), the facts and check of a set ([`set`]), the split of a phrase or a backup
//! ([`split`]), and the restore of a set with every share checked ([`restore`]).

pub mod bytewords;
pub mod engine;
pub mod export;
pub mod forms;
pub(crate) mod gf2;
pub(crate) mod gf256;
pub mod joint;
pub mod keeping;
pub mod marks;
pub mod repair;
pub mod restore;
pub mod set;
pub mod share;
pub mod split;
#[cfg(test)]
pub(crate) mod testing;
pub mod text;
pub mod typed;
