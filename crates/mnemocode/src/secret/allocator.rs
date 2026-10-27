//! The zeroing allocator that every artifact registers as its global allocator (ADR 0003): every
//! block is wiped before it is freed, so the copies that dependencies make of a secret
//! (unicode-normalization's output, scrypt's work area) and the WebAssembly glue's argument copies
//! are wiped too. `realloc` and `alloc_zeroed` are never handed to the system allocator: a grown or
//! shrunk block is a new block with the bytes copied and the old block wiped and freed.

#![allow(
    unsafe_code,
    reason = "a global allocator is unsafe by its trait (RUST-07: this module and the page locks only)"
)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::mem::MaybeUninit;

use zeroize::Zeroize;

/// The system's allocator, wiping every block before it frees it. Register it in each executable
/// and WebAssembly crate: `#[global_allocator] static ALLOCATOR: ZeroingAllocator = ZeroingAllocator;`.
#[derive(Clone, Copy, Debug, Default)]
pub struct ZeroingAllocator;

/// Wipes the `length` bytes at `pointer`, which may be uninitialized, as the spare capacity of a
/// vector is.
///
/// # Safety
///
/// `pointer` points to `length` bytes of one live allocation that nothing else uses meanwhile.
unsafe fn wipe(pointer: *mut u8, length: usize) {
    // SAFETY: the caller hands a live block of `length` bytes that only this call uses; as
    // `MaybeUninit<u8>` they need not be initialized, and every byte pattern is valid for it.
    let bytes =
        unsafe { std::slice::from_raw_parts_mut(pointer.cast::<MaybeUninit<u8>>(), length) };
    bytes.zeroize();
}

// SAFETY: every method keeps GlobalAlloc's contract by delegating the allocation and the freeing
// to `System` with the caller's layout; the only additions are writes inside the block it owns.
unsafe impl GlobalAlloc for ZeroingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: the caller's layout, as GlobalAlloc::alloc requires it, passed on unchanged.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: GlobalAlloc::dealloc is given a live block of `layout.size()` bytes, which is
        // wiped while it is still this allocation's, then freed with the layout it was made with.
        unsafe {
            wipe(pointer, layout.size());
            System.dealloc(pointer, layout);
        }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        // SAFETY: a new block of `layout.size()` bytes, zeroed before it is handed out.
        unsafe {
            let pointer = System.alloc(layout);
            if !pointer.is_null() {
                std::ptr::write_bytes(pointer, 0, layout.size());
            }
            pointer
        }
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        // SAFETY: GlobalAlloc::realloc guarantees that `new_size`, rounded up to `layout.align()`,
        // does not overflow, so the new layout is valid; the old block is live with `layout`.
        unsafe {
            let new_layout = Layout::from_size_align_unchecked(new_size, layout.align());
            let new_pointer = System.alloc(new_layout);
            if !new_pointer.is_null() {
                std::ptr::copy_nonoverlapping(pointer, new_pointer, layout.size().min(new_size));
                self.dealloc(pointer, layout);
            }
            new_pointer
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_grown_block_keeps_its_bytes() {
        let allocator = ZeroingAllocator;
        let layout = Layout::from_size_align(8, 1).unwrap();
        // SAFETY: a block made, grown and freed here with the layouts it was made with.
        unsafe {
            let pointer = allocator.alloc(layout);
            assert!(!pointer.is_null());
            std::ptr::copy_nonoverlapping(b"12345678".as_ptr(), pointer, 8);
            let grown = allocator.realloc(pointer, layout, 32);
            assert!(!grown.is_null());
            assert_eq!(std::slice::from_raw_parts(grown, 8), b"12345678");
            allocator.dealloc(grown, Layout::from_size_align(32, 1).unwrap());
        }
    }

    #[test]
    fn a_wiped_block_holds_zeros_and_keeps_its_length() {
        let mut block = vec![0xa5_u8; 48];
        // SAFETY: the live buffer of this vector, of its length, used by nothing else meanwhile.
        unsafe { wipe(block.as_mut_ptr(), block.len()) };
        assert_eq!(block, [0; 48]);
    }

    #[test]
    fn a_zeroed_block_holds_zeros() {
        let allocator = ZeroingAllocator;
        let layout = Layout::from_size_align(64, 8).unwrap();
        // SAFETY: a block made and freed here with its layout.
        unsafe {
            let pointer = allocator.alloc_zeroed(layout);
            assert!(!pointer.is_null());
            assert!(
                std::slice::from_raw_parts(pointer, 64)
                    .iter()
                    .all(|byte| *byte == 0)
            );
            allocator.dealloc(pointer, layout);
        }
    }
}
