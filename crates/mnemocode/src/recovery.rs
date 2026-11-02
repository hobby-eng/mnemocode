//! What a backup lost, found again: how a backup as given is read, the places of a phrase and codes
//! marked with ?, the date, word and marked-code searches, each a unit behind its feature
//! (ARCHITECTURE.md §8), the check of a written backup, and the restore of shares in the steps every
//! host takes.

pub mod backup_check;
#[cfg(feature = "search-date")]
pub mod date_search;
pub mod marked;
#[cfg(feature = "search-marked-codes")]
pub mod marked_search;
pub mod places;
pub mod reading;
#[cfg(all(feature = "sskr", feature = "search-date"))]
pub mod shares;
pub mod wallet_check;
#[cfg(feature = "search-word")]
pub mod word_search;
