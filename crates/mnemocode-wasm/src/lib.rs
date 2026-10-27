//! MnemoCode's WebAssembly binding for the wallet-tools pages: one module per library part, each
//! behind its `browser-*` feature, so that a page's file holds only the parts it uses
//! (docs/design/architect/ADR 0007). [`host`] is what every module shares.

#![forbid(unsafe_code)]

pub mod host;
#[cfg(feature = "browser-probe")]
pub mod probe;

/// Every block the WebAssembly frees is wiped first, the glue's copies of a secret included.
#[global_allocator]
static ALLOCATOR: mnemocode::secret::ZeroingAllocator = mnemocode::secret::ZeroingAllocator;
