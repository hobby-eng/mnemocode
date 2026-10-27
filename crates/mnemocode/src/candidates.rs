//! The candidates a search finds, for the Discovery Scanner (ARCHITECTURE.md §3): the MNCL list
//! of their entropies and passphrases ([`format`](mod@format)) and its writer ([`writer`]), the
//! protection a person chooses for it ([`protection`]), its age encryption to the Scanner's key or
//! with a passphrase ([`age`]) behind the gate of its known answers ([`gate`]), and which files are
//! let in ([`admission`]).

pub mod admission;
pub mod age;
pub mod format;
pub mod gate;
pub mod protection;
pub mod writer;
