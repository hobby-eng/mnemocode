//! Page locks counted per page, mhfe's (`mhfe/src/memory.rs:231-349`): mlock and munlock (and
//! VirtualLock and VirtualUnlock) act on whole pages and do not count, so one unlock would unlock a
//! page for every buffer on it. A page is unlocked only once the last guard that holds it is
//! dropped, so small secrets share pages within the lock budget (8 MiB since Linux 5.16, 64 KiB
//! before). Locking is best effort: a refusal leaves the secret unlocked, still wiped, and
//! [`any_lock_refused`] lets the command line warn once. The browser locks nothing.

#![allow(
    unsafe_code,
    reason = "the system calls that lock pages (RUST-07: this module and the allocator only)"
)]

use std::sync::atomic::{AtomicBool, Ordering};

/// Whether the system refused to lock a secret's pages since the program started.
static LOCK_REFUSED: AtomicBool = AtomicBool::new(false);

/// Whether the system refused to lock the pages of any secret so far, so that such a secret may
/// reach swap: the command line's lock warning (RUST-13).
pub fn any_lock_refused() -> bool {
    LOCK_REFUSED.load(Ordering::Relaxed)
}

/// The locked pages under a buffer, unlocked when this is dropped. The buffer must stay where it
/// is while this lives: only a buffer reserved at its final size, which never grows, is locked.
#[derive(Debug)]
pub(super) struct LockedPages {
    /// The address of the buffer, kept as a number: it is only handed back to the system.
    start: usize,
    bytes: usize,
    locked: bool,
}

impl LockedPages {
    /// Locks the `bytes` bytes at `start`, the whole capacity of a secret's buffer; a refusal is
    /// recorded for [`any_lock_refused`].
    pub(super) fn of(start: *const u8, bytes: usize) -> Self {
        let pages = Self::probe(start, bytes);
        if bytes > 0 && !pages.locked {
            LOCK_REFUSED.store(true, Ordering::Relaxed);
        }
        pages
    }

    /// Locks the `bytes` bytes at `start` without recording a refusal: for a probe that holds no
    /// secret, so that a refused probe never makes the lock warning speak of secrets.
    pub(super) fn probe(start: *const u8, bytes: usize) -> Self {
        let start = start as usize;
        Self {
            start,
            bytes,
            locked: bytes > 0 && counted::hold(start, bytes),
        }
    }

    /// Whether the system keeps the pages in memory while this lives.
    pub(super) fn is_locked(&self) -> bool {
        self.locked
    }
}

impl Drop for LockedPages {
    fn drop(&mut self) {
        if self.locked {
            counted::release(self.start, self.bytes);
        }
    }
}

#[cfg(any(unix, windows))]
mod counted {
    use std::collections::BTreeMap;
    use std::ops::RangeInclusive;
    use std::sync::{Mutex, PoisonError};

    use super::system;

    /// How many live guards hold each page, by page number. Every lock and unlock happens under
    /// this lock too, so that another thread never unlocks a page between a lock and its count.
    static HOLDERS: Mutex<BTreeMap<usize, usize>> = Mutex::new(BTreeMap::new());

    /// Locks the pages under `bytes` bytes at `start` and counts this guard as one of their
    /// holders; whether the system agreed.
    pub(super) fn hold(start: usize, bytes: usize) -> bool {
        let Some(size) = system::page_size() else {
            return false;
        };
        // Nothing panics while the lock is held, so it is never poisoned.
        let mut holders = HOLDERS.lock().unwrap_or_else(PoisonError::into_inner);
        if !system::lock(start, bytes) {
            // A refusal may have locked some of the pages; those no guard holds are unlocked again.
            for page in numbers(start, bytes, size) {
                if !holders.contains_key(&page) {
                    system::unlock(page * size, size);
                }
            }
            return false;
        }
        for page in numbers(start, bytes, size) {
            *holders.entry(page).or_insert(0) += 1;
        }
        true
    }

    /// Undoes [`hold`]: a page is unlocked when no other guard holds it any more.
    pub(super) fn release(start: usize, bytes: usize) {
        let Some(size) = system::page_size() else {
            return;
        };
        let mut holders = HOLDERS.lock().unwrap_or_else(PoisonError::into_inner);
        for page in numbers(start, bytes, size) {
            let Some(count) = holders.get_mut(&page) else {
                continue;
            };
            *count -= 1;
            if *count == 0 {
                holders.remove(&page);
                system::unlock(page * size, size);
            }
        }
    }

    /// The numbers of the pages under `bytes` bytes at `start`; `bytes` is not zero.
    fn numbers(start: usize, bytes: usize, size: usize) -> RangeInclusive<usize> {
        start / size..=(start + bytes - 1) / size
    }

    /// How many guards hold the page at `address`, for the Unix tests.
    #[cfg(all(test, unix))]
    pub(super) fn holders_of(address: usize) -> usize {
        let Some(size) = system::page_size() else {
            return 0;
        };
        let holders = HOLDERS.lock().unwrap_or_else(PoisonError::into_inner);
        holders.get(&(address / size)).copied().unwrap_or(0)
    }
}

/// Systems without page locks: the browser.
#[cfg(not(any(unix, windows)))]
mod counted {
    pub(super) fn hold(_start: usize, _bytes: usize) -> bool {
        false
    }

    pub(super) fn release(_start: usize, _bytes: usize) {}
}

#[cfg(unix)]
mod system {
    /// The size of a page, if the system tells it.
    pub(super) fn page_size() -> Option<usize> {
        // SAFETY: sysconf reads a configuration value and touches no memory of this program.
        let size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        usize::try_from(size).ok().filter(|size| *size > 0)
    }

    /// Locks the pages under `bytes` bytes at `start`; whether the system agreed.
    pub(super) fn lock(start: usize, bytes: usize) -> bool {
        // SAFETY: mlock only marks the pages of a range of this process's memory as resident; it
        // reads and writes none of it, and the range is a live buffer's capacity.
        unsafe { libc::mlock(start as *const libc::c_void, bytes) == 0 }
    }

    /// Unlocks the pages under `bytes` bytes at `start`.
    pub(super) fn unlock(start: usize, bytes: usize) {
        // SAFETY: munlock only lets the system page the range out again; it touches no memory.
        unsafe {
            libc::munlock(start as *const libc::c_void, bytes);
        }
    }
}

#[cfg(windows)]
mod system {
    use windows_sys::Win32::System::Memory::{VirtualLock, VirtualUnlock};
    use windows_sys::Win32::System::SystemInformation::{GetSystemInfo, SYSTEM_INFO};

    /// The size of a page.
    pub(super) fn page_size() -> Option<usize> {
        // SAFETY: GetSystemInfo fills the structure it is given and nothing else; SYSTEM_INFO is
        // plain data, valid when zeroed.
        let info = unsafe {
            let mut info: SYSTEM_INFO = std::mem::zeroed();
            GetSystemInfo(&mut info);
            info
        };
        usize::try_from(info.dwPageSize)
            .ok()
            .filter(|size| *size > 0)
    }

    /// Locks the pages under `bytes` bytes at `start` into the working set; whether Windows agreed.
    pub(super) fn lock(start: usize, bytes: usize) -> bool {
        // SAFETY: VirtualLock only keeps the pages of a range of this process's memory resident;
        // it reads and writes none of it, and the range is a live buffer's capacity.
        unsafe { VirtualLock(start as *const core::ffi::c_void, bytes) != 0 }
    }

    /// Unlocks the pages under `bytes` bytes at `start`.
    pub(super) fn unlock(start: usize, bytes: usize) {
        // SAFETY: VirtualUnlock only lets Windows page the range out again; it touches no memory.
        unsafe {
            VirtualUnlock(start as *const core::ffi::c_void, bytes);
        }
    }
}

#[cfg(test)]
#[cfg(unix)]
mod tests {
    #![expect(
        clippy::disallowed_methods,
        reason = "the tests read /proc/self/smaps and start threads to check the counts"
    )]

    use super::*;

    /// A whole page inside a buffer of the calling test alone, so that no other test's guard can
    /// hold it: the buffer, which must outlive the page's use, the page's address and its size.
    fn page_of_this_test() -> (Vec<u8>, usize, usize) {
        let size = system::page_size().unwrap();
        let area: Vec<u8> = Vec::with_capacity(3 * size);
        let page = (area.as_ptr() as usize).next_multiple_of(size);
        (area, page, size)
    }

    /// Two secrets on one page, as the allocator often places small buffers: dropping the guard
    /// of one, in either order, must not unlock the other (mhfe AUD-007-SEC002).
    #[test]
    fn a_shared_page_stays_locked_until_its_last_guard_is_dropped() {
        let (area, page, size) = page_of_this_test();
        let (first, second) = (page, page + size / 2);
        for first_dropped_first in [true, false] {
            let a = LockedPages::of(first as *const u8, 64);
            let b = LockedPages::of(second as *const u8, 64);
            if !(a.is_locked() && b.is_locked()) {
                // mlock refused here, such as with RLIMIT_MEMLOCK 0: nothing to count.
                return;
            }
            assert_eq!(counted::holders_of(page), 2);
            let remaining = if first_dropped_first {
                drop(a);
                b
            } else {
                drop(b);
                a
            };
            assert_eq!(counted::holders_of(page), 1);
            assert!(remaining.is_locked());
            #[cfg(target_os = "linux")]
            assert!(
                kernel_keeps_locked(page),
                "the page was unlocked under a live guard"
            );
            drop(remaining);
            assert_eq!(counted::holders_of(page), 0);
            #[cfg(target_os = "linux")]
            assert!(
                !kernel_keeps_locked(page),
                "the page stayed locked without a guard"
            );
        }
        drop(area);
    }

    /// A refused mlock, here of a page that is not mapped, holds nothing, leaves no count and is
    /// recorded for the lock warning; a refused probe is not. Linux only: macOS accepts that page,
    /// which lies in the range it reserves as __PAGEZERO.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_refused_lock_holds_nothing_and_is_recorded() {
        let size = system::page_size().unwrap();
        // The first page above address zero, which no process maps.
        let unmapped = size;
        let probe = LockedPages::probe(unmapped as *const u8, 64);
        assert!(!probe.is_locked());
        let refused = LockedPages::of(unmapped as *const u8, 64);
        assert!(!refused.is_locked());
        assert!(any_lock_refused());
        assert_eq!(counted::holders_of(unmapped), 0);
        drop(refused);
        assert_eq!(counted::holders_of(unmapped), 0);
    }

    /// Guards on one page taken and dropped from several threads at once leave the counts exact.
    #[test]
    fn guards_on_one_page_from_several_threads_keep_exact_counts() {
        const THREADS: usize = 8;
        const ROUNDS: usize = 500;
        let (area, page, _) = page_of_this_test();
        // Kept by this thread throughout, so the page must stay locked whatever the others do.
        let kept = LockedPages::of(page as *const u8, 16);
        if !kept.is_locked() {
            return;
        }
        std::thread::scope(|scope| {
            for thread in 0..THREADS {
                scope.spawn(move || {
                    let offset = 64 * (thread + 1);
                    for _ in 0..ROUNDS {
                        let guard = LockedPages::of((page + offset) as *const u8, 32);
                        assert!(guard.is_locked());
                    }
                });
            }
        });
        assert_eq!(counted::holders_of(page), 1);
        #[cfg(target_os = "linux")]
        assert!(
            kernel_keeps_locked(page),
            "the page was unlocked under a live guard"
        );
        drop(kept);
        assert_eq!(counted::holders_of(page), 0);
        #[cfg(target_os = "linux")]
        assert!(
            !kernel_keeps_locked(page),
            "the page stayed locked without a guard"
        );
        drop(area);
    }

    /// A `fill` that fails gets a buffer that is locked while it writes, and the error comes back
    /// once the bytes are wiped and their pages released (Drop wipes first, then the fields drop in
    /// their order). The buffer spans whole pages of its own, so no other test's guard holds them.
    #[test]
    fn a_failed_fill_releases_its_pages() {
        let size = system::page_size().unwrap();
        let mut page = 0;
        let mut was_locked = false;
        let refused = super::super::SecretBytes::build("Line", 3 * size, |filler| {
            page = (filler.written().as_ptr() as usize).next_multiple_of(size);
            was_locked = counted::holders_of(page) == 1;
            filler.extend(b"public bytes of a refused answer")?;
            Err(super::super::CapacityExceeded)
        });
        assert!(refused.is_err());
        if was_locked {
            assert_eq!(counted::holders_of(page), 0, "the pages were not released");
        }
    }

    #[test]
    fn an_empty_buffer_locks_nothing() {
        let pages = LockedPages::of(std::ptr::NonNull::<u8>::dangling().as_ptr(), 0);
        assert!(!pages.is_locked());
    }

    /// Whether the kernel marks the mapping that contains `address` as locked: mlock gives a
    /// locked range a mapping of its own, whose VmFlags in /proc/self/smaps include "lo".
    #[cfg(target_os = "linux")]
    fn kernel_keeps_locked(address: usize) -> bool {
        let smaps = std::fs::read_to_string("/proc/self/smaps").unwrap();
        let mut inside = false;
        for line in smaps.lines() {
            let range = line.split_once(' ').map_or(line, |(range, _)| range);
            if let Some((start, end)) = range.split_once('-')
                && let (Ok(start), Ok(end)) = (
                    usize::from_str_radix(start, 16),
                    usize::from_str_radix(end, 16),
                )
            {
                inside = (start..end).contains(&address);
                continue;
            }
            if let (true, Some(flags)) = (inside, line.strip_prefix("VmFlags:")) {
                return flags.split_whitespace().any(|flag| flag == "lo");
            }
        }
        false
    }
}
