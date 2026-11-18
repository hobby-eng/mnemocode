//! Deterministic public test data, never for real backup generation.
use mnemocode::{
    random::{Random, RandomError},
    sskr::{engine, share::Share},
};

pub(crate) struct PublicFixed(pub(crate) u8);
impl Random for PublicFixed {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        bytes.fill(self.0);
        Ok(())
    }
}

pub(crate) fn shares(byte: u8) -> Vec<Share> {
    engine::split(
        &[0; 16],
        1,
        &[engine::Group {
            threshold: 2,
            count: 3,
        }],
        &mut PublicFixed(byte),
    )
    .unwrap()
    .iter()
    .map(|p| Share::of_payload(p).unwrap())
    .collect()
}
