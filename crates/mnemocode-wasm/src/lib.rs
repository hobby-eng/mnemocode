//! MnemoCode's WebAssembly binding for the wallet-tools pages: one module per library part, each
//! behind its `browser-*` feature, so that a page's file holds only the parts it uses
//! (docs/design/architect/ADR 0007). [`host`] is what every module shares.

#![forbid(unsafe_code)]

#[cfg(feature = "browser-candidates")]
pub mod candidates;
#[cfg(feature = "browser-cards")]
pub mod cards;
pub mod host;
#[cfg(feature = "browser-phrase")]
pub mod phrase;
#[cfg(feature = "browser-probe")]
pub mod probe;
#[cfg(feature = "browser-qr")]
pub mod qr;
#[cfg(feature = "browser-recovery")]
pub mod recovery;
#[cfg(feature = "browser-sskr")]
pub mod sskr;
#[cfg(feature = "browser-wallet")]
pub mod wallet;
#[cfg(feature = "browser-phrase")]
pub mod words;

/// Every block the WebAssembly frees is wiped first, the glue's copies of a secret included.
#[global_allocator]
static ALLOCATOR: mnemocode::secret::ZeroingAllocator = mnemocode::secret::ZeroingAllocator;
