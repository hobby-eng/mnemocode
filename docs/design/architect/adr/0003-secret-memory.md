# Secret owners with counted page locks and a zeroing allocator

## Context

RUST-13 and CORE-24 ask for secrets in owner types that wipe them, locked out of swap where their
size allows, redacted in `Debug`. The old Rust attempt gave every secret its own mmap and parsed
all of `/proc/self/smaps` on each allocation, and a refused mlock failed the operation
(`mnemocode-rust/crates/mnemocode-native/src/memory.rs:85-96`, `memory/linux/sys.rs:126-128`;
design/assess, decision 2). Some secrets are large or of unknown size when work starts: a search
keeps up to 2^19 + 1 found entropies (TS `src/core/candidate-list.ts:63,71`, about 16.8 MiB at 32
bytes), a candidate list reaches 155,189,248 bytes (CAP-RECOVERY-CANDIDATE-LIST-FORMAT), both over
RLIMIT_MEMLOCK (8 MiB since Linux 5.16, 64 KiB before). Dependencies make copies no owner reaches:
scrypt 0.12.0 allocates its work area with `vec!` and never wipes it
(`scrypt-0.12.0/src/lib.rs:119,133-134`); wasm-bindgen copies every argument into linear memory
and frees it through the global allocator (`wasm-bindgen-0.2.129/src/rt/mod.rs:699-772`), and its
glue grows and shrinks string buffers with `__wbindgen_realloc`
(`wasm-bindgen-cli-support-0.2.129/src/js/mod.rs:3078-3088`); the TS rewrote the generated glue to
wipe (CAP-SSKR-ENGINE-MEMORY-WIPE).

## Decision

- `SecretBytes` and `SecretText`: a buffer reserved at its final size, locked before it is filled,
  never grown, zeroized then unlocked on drop; `Debug` is `[<Label>: redacted]`, no `Display`.
  Domain owners wrap them and lend slices.
- Final sizes not known from the input are fixed when the work is made: a search's found list is
  one `SecretBytes` reserved at min(candidates, keep) × entropy length; the candidate-list writer
  reserves the list owner at its exact size from the count; the CLI's answer buffer is reserved at
  its question's limit (PLAN, "Owner decisions"; TS: 1 MiB). The search keeps one working phrase, never an owner per candidate.
- Locks are counted per page, mhfe's code (`mhfe/src/memory.rs:231-349`), so small secrets share
  pages within RLIMIT_MEMLOCK. This replaces the platform report's "pages of their own"
  (decision 3), whose only gain was dropping the count. An owner over the lock budget is not
  locked: the allocator wipes it, and the lock warning says so.
- The CLI reads and writes secrets with read(2) and write(2) on its descriptors, since std's `stdin()` and `stdout()` never carry a secret: their static `BufReader` (8 KiB) and `LineWriter` are never freed, so the allocator never wipes the last input or unflushed piece (Rust 1.99.1 <https://github.com/rust-lang/rust/blob/1.99.1/library/std/src/io/stdio.rs>, lines 341-345, 647 and 722; mhfe reads typed secrets through `io::stdin().lock()`, `hidden_input.rs:106,114,144`).
- `ZeroingAllocator` wraps the system allocator: every block is zeroized (volatile, `zeroize`)
  before it is freed. `realloc` and `alloc_zeroed` are never delegated to the system allocator:
  `realloc` allocates the new block, copies, then wipes and frees the old block through the
  wiping `dealloc` (`GlobalAlloc`'s default), shrinks included. No block is marked MADV_DONTDUMP:
  once dumpable reads 0 the kernel makes no dump (platform report, L-DUMPABLE), and the owner
  dropped that clause from RUST-13 on 2026-10-27. The executable and every WASM file register it.
- The bip39 crate's `Mnemonic` (50 bytes, `ZeroizeOnDrop` with its `zeroize` feature) is a stack
  value, made inside one call of the `bip39` module and dropped there; the arrays from
  `to_entropy_array` and `to_seed_normalized` are copied into `Entropy` and `Seed` and wiped.
  Without `alloc` the crate allocates nothing; its stack copies (entropy bits, PBKDF2 pads and
  HMAC states) are left to the WASM stack scrub and, natively, to the process protections.

## Rejected alternatives

- A dedicated mapping per secret with guard pages and WIPEONFORK: the smaps cost on every
  allocation and the refusal past the lock budget above; guard pages guard the program's own code
  (CORE-54).
- An allocator port passed to every constructor (`mnemocode-rust/crates/mnemocode-core/src/memory.rs:73-94`):
  every API carries it, and the browser has nothing to pass.
- Delegating `realloc` to the system allocator: it frees the old block inside the call, so the
  old bytes cannot be wiped (a write afterwards is a use after free that corrupts dlmalloc's free
  list on wasm32), and an in-place shrink leaves the tail as it was.
- Rewriting wasm-bindgen's glue to wipe returned buffers: needed only without the zeroing allocator.

## Consequences

- Wiping no longer depends on every dependency zeroizing; freeing costs a write of the block, and
  every `realloc` a copy.
- The B-WIPE scan of `memory.buffer` is the test that holds this in the browser: after each
  secret entry, for every secret value it handles, with a public secret reallocated up and down and
  a refused argument beside a secret among its cases (GATES `wasm`); natively, core dumps and
  readers are excluded by the process protections instead.
- A secret may cross into the WASM as `&str`: the glue's copies are freed through this allocator
  once the Rust entry returns. A glue check or enum conversion that throws after the copy leaves it
  never freed (`wasm-bindgen-cli-support-0.2.129/src/js/binding.rs:836-839,906-914,959-975`,
  `wasm-bindgen-macro-support-0.2.129/src/codegen.rs:5064`), so a binding entry that takes a secret
  takes every other argument as a number, a boolean or a `JsValue`, converted and refused inside
  Rust: no wasm-bindgen enum or class argument, and no `Option` of one (TS AUD-012-SEC001).
- A trap leaves every live secret in linear memory (`panic = "abort"` runs no `Drop`), so the
  binding's contract tells the page to drop the instance after a `WebAssembly.RuntimeError`.
- The binding's stack scrub after each secret call has one named size, set from the deepest stack
  measured over every secret entry, with the measurement and the margin beside it; TS measured the
  engine alone (`mnemocode/sskr-wasm/rust/src/lib.rs:22-25`).
- `secret/pages.rs` and `secret/allocator.rs` are the library's only unsafe code.
