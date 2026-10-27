//! The `mnemocode` executable: the command line and the start menu over the `mnemocode` and
//! `mnemocode-cards` libraries. It translates input and output only; the process protections,
//! the terminal and the files live in its `os` module (docs/design/architect/ARCHITECTURE.md §5).

/// Every block the program frees is wiped first, the copies dependencies make of a secret included.
#[global_allocator]
static ALLOCATOR: mnemocode::secret::ZeroingAllocator = mnemocode::secret::ZeroingAllocator;

fn main() {}
