//! One fixed allocation, its counted page lock, and wipe-before-unlock lifetime.

use super::pages::LockedPages;
use std::ops::{Deref, DerefMut};
use zeroize::Zeroize;

pub(super) struct Storage<T: Zeroize> {
    pub(super) values: Vec<T>,
    // Drop wipes first; fields then free the allocation before releasing its page hold.
    locked: LockedPages,
}
impl<T: Zeroize> Storage<T> {
    pub(super) fn new(values: Vec<T>) -> Self {
        // Vec's valid allocation bounds capacity * element width; a ZST has width zero.
        let bytes = values.capacity() * std::mem::size_of::<T>();
        Self::hold(values, bytes)
    }
    pub(super) fn large(values: Vec<T>) -> Self {
        Self::hold(values, 0)
    }
    fn hold(values: Vec<T>, bytes: usize) -> Self {
        let locked = LockedPages::of(values.as_ptr().cast::<u8>(), bytes);
        Self { values, locked }
    }
    pub(super) fn is_locked(&self) -> bool {
        self.locked.is_locked()
    }
}
impl<T: Zeroize> Drop for Storage<T> {
    fn drop(&mut self) {
        self.values.zeroize();
    }
}

/// Fixed typed storage with wipe-before-unlock ownership. Only this allocation's
/// pages are locked; allocations inside an element remain the element's responsibility.
/// Debug never formats the values. The buffer cannot grow beyond its initial capacity.
pub struct SecretVec<T: Zeroize>(Storage<T>);
impl<T: Zeroize> SecretVec<T> {
    /// Adopt an existing allocation without copying and request its page hold.
    /// This cannot retroactively protect the caller's preparation of its values.
    pub fn new(values: Vec<T>) -> Self {
        Self(Storage::new(values))
    }
    /// Reserve and request locks before any element is filled.
    pub fn with_capacity(capacity: usize) -> Self {
        Self::new(Vec::with_capacity(capacity))
    }
    /// Append within the fixed capacity. A rejected owned value is wiped here.
    pub fn push(&mut self, mut value: T) -> Result<(), super::CapacityExceeded> {
        if self.len() == self.0.values.capacity() {
            value.zeroize();
            return Err(super::CapacityExceeded);
        }
        self.0.values.push(value);
        Ok(())
    }
    /// Wipe and drop elements after `len`, retaining the same allocation and page hold.
    pub fn truncate(&mut self, len: usize) {
        if len < self.len() {
            self.0.values[len..].iter_mut().for_each(Zeroize::zeroize);
            self.0.values.truncate(len);
        }
    }
    /// Whether the operating system granted this allocation's page hold.
    pub fn is_locked(&self) -> bool {
        self.0.is_locked()
    }
}
impl<T: Zeroize + Clone> Clone for SecretVec<T> {
    fn clone(&self) -> Self {
        let mut copy = Storage::new(Vec::with_capacity(self.len()));
        copy.values.extend_from_slice(self);
        Self(copy)
    }
}
impl<T: Zeroize + PartialEq> PartialEq for SecretVec<T> {
    fn eq(&self, other: &Self) -> bool {
        self.0.values == other.0.values
    }
}
impl<T: Zeroize + Eq> Eq for SecretVec<T> {}
impl<T: Zeroize> Deref for SecretVec<T> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        &self.0.values
    }
}
impl<T: Zeroize> DerefMut for SecretVec<T> {
    fn deref_mut(&mut self) -> &mut [T] {
        &mut self.0.values
    }
}
impl<T: Zeroize> std::fmt::Debug for SecretVec<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        super::redacted(f, "Secret values")
    }
}

/// Aligned word-index owners use the same typed storage as other small secrets.
pub(crate) type SecretU16s = SecretVec<u16>;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn word_owners_keep_values_alignment_spare_capacity_and_independent_clones() {
        let mut values = Vec::with_capacity(2_048);
        values.extend([0, 102, 2_047]);
        let owner = SecretU16s::new(values);
        let mut cloned = owner.clone();
        assert_eq!(&*owner, &*cloned);
        cloned[1] = 7;
        assert_eq!(owner[1], 102);
        assert_eq!(cloned[1], 7);
        assert_eq!(owner.0.values.capacity(), 2_048);
        if super::super::probe_lock(4_096) {
            assert!(owner.0.is_locked());
            assert!(cloned.0.is_locked());
        }
        drop(owner);
        assert_eq!(&*cloned, &[0, 7, 2_047]);
    }
    #[test]
    fn a_fixed_owner_wipes_rejected_and_retained_values_and_redacts_debug() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        struct Observed(u32, Arc<AtomicUsize>);
        impl Zeroize for Observed {
            fn zeroize(&mut self) {
                self.0.zeroize();
                assert_eq!(self.0, 0);
                self.1.fetch_add(1, Ordering::Relaxed);
            }
        }
        let retired = Arc::new(AtomicUsize::new(0));
        let mut owner = SecretVec::with_capacity(1);
        owner.push(Observed(0x24, retired.clone())).unwrap();
        assert!(owner.push(Observed(0x42, retired.clone())).is_err());
        assert_eq!(retired.load(Ordering::Relaxed), 1);
        assert_eq!(format!("{owner:?}"), "[Secret values: redacted]");
        assert_eq!(owner.len(), 1);
        drop(owner);
        assert_eq!(retired.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn truncating_wipes_removed_elements_before_drop_and_keeps_the_allocation() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        struct Observed(u8, Arc<AtomicUsize>);
        impl Zeroize for Observed {
            fn zeroize(&mut self) {
                self.0.zeroize();
                self.1.fetch_add(1, Ordering::Relaxed);
            }
        }
        impl Drop for Observed {
            fn drop(&mut self) {
                assert_eq!(self.0, 0);
            }
        }
        let wiped = Arc::new(AtomicUsize::new(0));
        let mut values = SecretVec::with_capacity(3);
        for value in [1, 2, 3] {
            values.push(Observed(value, wiped.clone())).unwrap();
        }
        let pointer = values.as_ptr();
        values.truncate(1);
        assert_eq!(wiped.load(Ordering::Relaxed), 2);
        assert_eq!(values.as_ptr(), pointer);
        assert_eq!(values[0].0, 1);
        values.truncate(9);
        assert_eq!(values.len(), 1);
        drop(values);
        assert_eq!(wiped.load(Ordering::Relaxed), 3);
    }

    #[test]
    fn empty_and_all_dictionary_word_sets_remain_supported() {
        assert!(SecretU16s::new(Vec::new()).is_empty());
        let owner = SecretU16s::new((0..2_048).collect());
        assert_eq!(owner.len(), 2_048);
        assert_eq!(owner[2_047], 2_047);
    }
}
