//! Actual generated-wrapper success paths, including wasm-bindgen's by-value class destructor.

use wasmi::{Engine, Module};

use super::entries::ENTRY_PHRASES;
use super::{Object, allocator_name, started, wasm_error};
use crate::Failure;

/// A partial secret must be rejected even if the rest was overwritten on free.
const WINDOW: usize = 8;

fn positions(memory: &[u8], marker: &[u8]) -> Vec<(usize, usize)> {
    memory
        .windows(WINDOW)
        .enumerate()
        .filter_map(|(at, bytes)| {
            marker
                .windows(WINDOW)
                .position(|window| window == bytes)
                .map(|within| (at, within))
        })
        .take(8)
        .collect()
}

/// Runs the actual encode/free exports as the pinned generated JS success path does.
pub(in crate::wasm) fn backup_abi_problems(
    bytes: &[u8],
    glue: &str,
) -> Result<Vec<String>, Failure> {
    let engine = Engine::default();
    let module = Module::new(&engine, bytes).map_err(wasm_error)?;
    // The public phrases in entries encode16/32bytes rising from0xA0 by3.
    let target: Vec<u8> = (0..32).map(|i| 0xa0 + i * 3).collect();
    let mut problems = Vec::new();
    println!(
        "wasm backup ABI: file {}, glue {}",
        crate::repository::sha256(bytes),
        crate::repository::sha256(glue.as_bytes())
    );
    for (number, phrase) in ENTRY_PHRASES.into_iter().enumerate() {
        let (mut store, instance, memory) = started(&engine, &module, glue, allocator_name(glue)?)?;
        if !positions(memory.data(&store), &target).is_empty() {
            return Err(Failure(
                "fresh ABI instance already contains the marker".to_owned(),
            ));
        }
        let at = memory.data(&store).len() - target.len();
        let kept = memory.data(&store)[at..].to_vec();
        memory.data_mut(&mut store)[at..].copy_from_slice(&target);
        let control = positions(memory.data(&store), &target);
        memory.data_mut(&mut store)[at..].copy_from_slice(&kept);
        if control.first() != Some(&(at, 0)) || !positions(memory.data(&store), &target).is_empty()
        {
            return Err(Failure(
                "the ABI marker search failed its positive/negative control".to_owned(),
            ));
        }
        let adjust = instance
            .get_typed_func::<i32, i32>(&store, "__wbindgen_add_to_stack_pointer")
            .map_err(wasm_error)?;
        // wasm-bindgen reserves16bytes for Result's object/error/flag words.
        let ret = adjust.call(&mut store, -16).map_err(wasm_error)?;
        let phrase = store.data_mut().add(Object::Text(phrase.to_owned()));
        let dates = store
            .data_mut()
            .add(Object::Text("23-09-2026 01-02-2001".to_owned()));
        let form = store.data_mut().add(Object::Text("english".to_owned()));
        let mode = store.data_mut().add(Object::Text("seedshift".to_owned()));
        instance
            .get_typed_func::<(i32, i32, i32, i32, i32, i32), ()>(&store, "encodedbackup_encode")
            .map_err(wasm_error)?
            .call(&mut store, (ret, phrase, dates, form, mode, 0))
            .map_err(wasm_error)?;
        let at =
            usize::try_from(ret).map_err(|_| Failure("negative ABI return pointer".to_owned()))?;
        let data = memory.data(&store);
        let word =
            |offset| i32::from_le_bytes(data[offset..offset + 4].try_into().unwrap_or([0; 4]));
        let object = word(at);
        if word(at + 8) != 0 || object <= 0 {
            return Err(Failure(
                "public ABI encoding did not return an object".to_owned(),
            ));
        }
        adjust.call(&mut store, 16).map_err(wasm_error)?;
        let before = positions(memory.data(&store), &target);
        instance
            .get_typed_func::<(i32, i32), ()>(&store, "__wbg_encodedbackup_free")
            .map_err(wasm_error)?
            .call(&mut store, (object, 0))
            .map_err(wasm_error)?;
        let after = positions(memory.data(&store), &target);
        println!("wasm backup ABI {number}: live-owner offsets {before:?}; after free {after:?}");
        if !after.is_empty() {
            problems.push(format!(
                "exported backup ABI {number} leaves an entropy window after free"
            ));
        }
    }
    Ok(problems)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_partial_marker_is_found_at_the_last_possible_offset() {
        let target: Vec<u8> = (0..32).map(|i| 0xa0 + i * 3).collect();
        for within in 0..=target.len() - WINDOW {
            let mut data = vec![0; 19];
            data.extend_from_slice(&target[within..within + WINDOW]);
            assert_eq!(positions(&data, &target), [(19, within)]);
        }
    }

    #[test]
    fn zeroed_memory_and_short_prefixes_are_not_marker_hits() {
        let target: Vec<u8> = (0..32).map(|i| 0xa0 + i * 3).collect();
        assert!(positions(&[0; 128], &target).is_empty());
        assert!(positions(&target[..WINDOW - 1], &target).is_empty());
    }
}
