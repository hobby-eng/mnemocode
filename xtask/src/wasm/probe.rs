//! The test profile's checks of the binding itself (B-WIPE), run on the built file in wasmi, an
//! interpreter of WebAssembly written in Rust: each probe entry takes a public marker the way a
//! secret entry takes a secret, and afterwards the instance's whole memory is searched for it; the
//! search is first shown to find a marker written into the memory; `probeText` takes it as a
//! page's string, read into Rust through the glue's `__wbindgen_string_get` (emulated: the string
//! copied into a block of the instance's allocator, as `passStringToWasm0` copies it), the way a
//! secret entry reads its text (`host::text`). A refusal is followed through
//! the glue's imports, which are emulated from their code in the glue (`new RangeError(…)`,
//! `JSON.parse(…)`, `Object.defineProperty(…)`): it must reach a page as TS's kind of error, with
//! its message and a `code` defined enumerable and neither writable nor configurable. Each row of
//! the library's self-check, the known answers of the secret work of every part, runs with the
//! stack painted first: the lowest byte it left is how deep it went, which must stay inside the
//! scrub of `after_secret` (ARCHITECTURE.md §6), and once scrubbed the stack must not hold the seed
//! the rows derive. [`entries`] searches what the secret entries leave.

mod entries;

use wasmi::{Caller, Engine, Instance, Linker, Memory, Module, Store};

use self::entries::{Watch, entry_problems, entry_returned};
use crate::Failure;

/// The public marker the probes take.
const MARKER: &[u8] = b"public marker of the MnemoCode memory scan, 0123456789";
/// The bytes of the marker probeShares splits as a secret: as many as the longest phrase's.
const SECRET_BYTES: usize = 32;
/// The refusal probeRefusal throws (crates/mnemocode-wasm/src/probe.rs).
const REFUSAL_CODE: &str = "core.pieces.piece-whole-width-at-least-1";
const REFUSAL_MESSAGE: &str = "A piece needs a whole width of at least 1.";
/// The first half of the seed of the public phrase with no passphrase, which the library's rows
/// derive (`PUBLIC_SEED`, crates/mnemocode/src/checks.rs): no row holds it in raw bytes.
const ROW_SEED: &[u8] = b"\x5e\xb0\x0b\xbd\xdc\xf0\x69\x08\x48\x89\xa8\xab\x91\x55\x56\x81\x65\xf5\xc4\x53\xcc\xb8\x5e\x70\x81\x1a\xae\xd6\xf6\xda\x5f\xc1";
/// The stack below an entry that is painted before a row: within the 1 MiB stack of a wasm32 file,
/// and twice the scrub's reach, so that a row past it shows.
const PAINTED_BYTES: usize = 256 * 1024;
const PAINT: u8 = 0xa5;
/// The glue's slot of undefined.
const UNDEFINED_SLOT: i32 = 1024;
/// The glue's first free slot of its object heap: 1024 slots, then undefined, null, true, false.
const HEAP_START: usize = 1028;
/// The first byte of what the emulated `crypto.getRandomValues` gives, and its step.
const RANDOM_START: u8 = 0x31;
const RANDOM_STEP: u8 = 5;
/// The bytes of randomness searched for: a key or a seed drawn from it.
const RANDOM_SEARCHED: usize = 32;

/// What an import does, as its body in the glue says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Operation {
    /// `new <kind>(string)`.
    NewError(&'static str),
    /// `JSON.parse(string)`.
    Parse,
    /// `Object.defineProperty(object, key, descriptor)`.
    DefineProperty,
    /// `takeObject(index)`: the object's reference dropped.
    Drop,
    /// `__wbindgen_string_get`: a string object copied into the instance's memory.
    StringGet,
    /// `const ret = getStringFromWasm0(…)`: a string object made.
    StringNew,
    /// `getObject(index) === undefined`.
    IsUndefined,
    /// `crypto.getRandomValues(…)`: public bytes written where they are asked for.
    Random,
    /// `throw new Error(…)`.
    Throw,
    /// `globalThis.probeEntryReturned()`: the gate looks at the stack.
    EntryReturned,
    /// `addHeapObject(getObject(index))`: a reference of its own to an object.
    CloneRef,
}

/// An object of the emulated page.
#[derive(Clone, Debug)]
enum Object {
    Error {
        kind: &'static str,
        message: String,
        properties: Vec<(String, String)>,
    },
    Json(String),
    /// A page's string.
    Text(String),
}

/// The emulated page: its objects by index, and what it watches.
#[derive(Debug, Default)]
struct Page {
    heap: Vec<Option<Object>>,
    watch: Option<Watch>,
}

impl Page {
    fn add(&mut self, object: Object) -> i32 {
        self.heap.push(Some(object));
        i32::try_from(HEAP_START + self.heap.len() - 1).unwrap_or(i32::MAX)
    }

    fn get(&self, index: i32) -> Option<&Object> {
        let slot = usize::try_from(index).ok()?.checked_sub(HEAP_START)?;
        self.heap.get(slot)?.as_ref()
    }
}

/// The imports of the glue (`name: function(…) {` and the line after it), with their operations.
fn imports_of(glue: &str) -> Vec<(String, Operation)> {
    let lines: Vec<&str> = glue.lines().collect();
    let mut imports = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let Some((name, rest)) = line.trim().split_once(": function(") else {
            continue;
        };
        if !name.starts_with("__wb") || !rest.ends_with('{') {
            continue;
        }
        let body = lines.get(index + 1).copied().unwrap_or_default();
        let after = lines.get(index + 2).copied().unwrap_or_default();
        let operation = if name.contains("__wbindgen_string_get") {
            Operation::StringGet
        } else if body.contains("probeEntryReturned(") {
            Operation::EntryReturned
        } else if body.contains("throw new Error(") {
            Operation::Throw
        } else if body.contains("=== undefined") {
            Operation::IsUndefined
        } else if body.contains("getRandomValues(") {
            Operation::Random
        } else if body.contains("const ret = getObject(arg0);") {
            Operation::CloneRef
        } else if body.contains("const ret = getStringFromWasm0(")
            || after.contains("const ret = getStringFromWasm0(")
        {
            Operation::StringNew
        } else if body.contains("new RangeError(") {
            Operation::NewError("RangeError")
        } else if body.contains("new TypeError(") {
            Operation::NewError("TypeError")
        } else if body.contains("new Error(") {
            Operation::NewError("Error")
        } else if body.contains("JSON.parse(") {
            Operation::Parse
        } else if body.contains("Object.defineProperty(") {
            Operation::DefineProperty
        } else if body.contains("takeObject(arg0)") {
            Operation::Drop
        } else {
            continue;
        };
        imports.push((name.to_owned(), operation));
    }
    imports
}

/// wasmi's error as the check's failure.
fn wasm_error(error: wasmi::Error) -> Failure {
    Failure(format!("wasmi: {error}"))
}

/// The string the glue would read from the instance's memory at `pointer` and `length`.
fn string_at(caller: &Caller<'_, Page>, pointer: i32, length: i32) -> String {
    let Some(memory) = caller
        .get_export("memory")
        .and_then(wasmi::Extern::into_memory)
    else {
        return String::new();
    };
    let (Ok(start), Ok(length)) = (usize::try_from(pointer), usize::try_from(length)) else {
        return String::new();
    };
    memory
        .data(caller)
        .get(start..start + length)
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        .unwrap_or_default()
}

/// `__wbindgen_string_get` of the object at `index`: its string copied into a block that the
/// instance's `malloc` gives, the block and its length written at `out`; 0 and 0 for another
/// object.
fn string_get(
    caller: &mut Caller<'_, Page>,
    malloc: &str,
    out: i32,
    index: i32,
) -> Result<(), wasmi::Error> {
    let text = match caller.data().get(index) {
        Some(Object::Text(text)) => Some(text.clone()),
        _ => None,
    };
    let memory = caller
        .get_export("memory")
        .and_then(wasmi::Extern::into_memory)
        .ok_or_else(|| wasmi::Error::new("the probe file exports no memory"))?;
    let (pointer, length) = match text {
        Some(text) => {
            let allocate = caller
                .get_export(malloc)
                .and_then(wasmi::Extern::into_func)
                .ok_or_else(|| wasmi::Error::new("the probe file exports no allocator"))?
                .typed::<(i32, i32), i32>(&*caller)?;
            let length = i32::try_from(text.len()).unwrap_or(0);
            let pointer = allocate.call(&mut *caller, (length, 1))?;
            let start = usize::try_from(pointer).unwrap_or(0);
            memory.data_mut(&mut *caller)[start..start + text.len()]
                .copy_from_slice(text.as_bytes());
            (pointer, length)
        }
        None => (0, 0),
    };
    let at = usize::try_from(out).unwrap_or(0);
    let data = memory.data_mut(&mut *caller);
    data[at..at + 4].copy_from_slice(&pointer.to_le_bytes());
    data[at + 4..at + 8].copy_from_slice(&length.to_le_bytes());
    Ok(())
}

/// The object that `make` makes of the string at `pointer`, added to the emulated page.
fn made_of_text(
    caller: &mut Caller<'_, Page>,
    pointer: i32,
    length: i32,
    make: fn(String) -> Object,
) -> i32 {
    let text = string_at(caller, pointer, length);
    caller.data_mut().add(make(text))
}

/// The public bytes of the emulated `crypto.getRandomValues`, from their first on each call.
fn random_bytes(count: usize) -> Vec<u8> {
    let mut byte = RANDOM_START;
    (0..count)
        .map(|_| {
            let this = byte;
            byte = byte.wrapping_add(RANDOM_STEP);
            this
        })
        .collect()
}

/// `crypto.getRandomValues` of the bytes at `pointer`.
fn random_values(
    mut caller: Caller<'_, Page>,
    pointer: i32,
    length: i32,
) -> Result<(), wasmi::Error> {
    let memory = caller
        .get_export("memory")
        .and_then(wasmi::Extern::into_memory)
        .ok_or_else(|| wasmi::Error::new("the probe file exports no memory"))?;
    let (start, count) = (
        usize::try_from(pointer).unwrap_or(0),
        usize::try_from(length).unwrap_or(0),
    );
    memory.data_mut(&mut caller)[start..start + count].copy_from_slice(&random_bytes(count));
    Ok(())
}

/// A linker that gives every import of `module` the operation the glue gives it, `malloc` the
/// instance's allocator; one the probes need not run traps.
fn linker(
    engine: &Engine,
    module: &Module,
    glue: &str,
    malloc: &str,
) -> Result<Linker<Page>, Failure> {
    let known = imports_of(glue);
    let mut linker = Linker::new(engine);
    let fail = |error: wasmi::errors::LinkerError| Failure(format!("wasmi: {error}"));
    for import in module.imports() {
        let (namespace, name) = (import.module().to_owned(), import.name().to_owned());
        let operation = known
            .iter()
            .find(|(known, _)| *known == name)
            .map(|(_, operation)| *operation);
        match operation {
            Some(Operation::NewError(kind)) => {
                linker
                    .func_wrap(
                        &namespace,
                        &name,
                        move |mut caller: Caller<'_, Page>, pointer: i32, length: i32| {
                            let message = string_at(&caller, pointer, length);
                            caller.data_mut().add(Object::Error {
                                kind,
                                message,
                                properties: Vec::new(),
                            })
                        },
                    )
                    .map_err(fail)?;
            }
            Some(Operation::Parse) => {
                let parsed = |mut caller: Caller<'_, Page>, pointer: i32, length: i32| {
                    made_of_text(&mut caller, pointer, length, Object::Json)
                };
                linker.func_wrap(&namespace, &name, parsed).map_err(fail)?;
            }
            Some(Operation::DefineProperty) => {
                linker
                    .func_wrap(
                        &namespace,
                        &name,
                        |mut caller: Caller<'_, Page>,
                         target: i32,
                         pointer: i32,
                         length: i32,
                         descriptor: i32| {
                            let key = string_at(&caller, pointer, length);
                            let page = caller.data_mut();
                            let text = match page.get(descriptor) {
                                Some(Object::Json(text)) => text.clone(),
                                _ => String::new(),
                            };
                            let slot = usize::try_from(target)
                                .ok()
                                .and_then(|index| index.checked_sub(HEAP_START));
                            if let Some(Some(Object::Error { properties, .. })) =
                                slot.and_then(|slot| page.heap.get_mut(slot))
                            {
                                properties.push((key, text));
                            }
                            target
                        },
                    )
                    .map_err(fail)?;
            }
            Some(Operation::Drop) => {
                linker
                    .func_wrap(&namespace, &name, |_: Caller<'_, Page>, _index: i32| {})
                    .map_err(fail)?;
            }
            Some(Operation::StringGet) => {
                let malloc = malloc.to_owned();
                linker
                    .func_wrap(
                        &namespace,
                        &name,
                        move |mut caller: Caller<'_, Page>, out: i32, index: i32| {
                            string_get(&mut caller, &malloc, out, index)
                        },
                    )
                    .map_err(fail)?;
            }
            Some(Operation::StringNew) => {
                let made = |mut caller: Caller<'_, Page>, pointer: i32, length: i32| {
                    made_of_text(&mut caller, pointer, length, Object::Text)
                };
                linker.func_wrap(&namespace, &name, made).map_err(fail)?;
            }
            Some(Operation::IsUndefined) => {
                linker
                    .func_wrap(&namespace, &name, |_: Caller<'_, Page>, index: i32| {
                        i32::from(index == UNDEFINED_SLOT)
                    })
                    .map_err(fail)?;
            }
            Some(Operation::CloneRef) => {
                linker
                    .func_wrap(
                        &namespace,
                        &name,
                        |mut caller: Caller<'_, Page>, index: i32| match caller.data().get(index) {
                            Some(object) => {
                                let object = object.clone();
                                caller.data_mut().add(object)
                            }
                            None => index,
                        },
                    )
                    .map_err(fail)?;
            }
            Some(Operation::EntryReturned) => {
                linker
                    .func_wrap(&namespace, &name, entry_returned)
                    .map_err(fail)?;
            }
            Some(Operation::Random) => {
                linker
                    .func_wrap(&namespace, &name, random_values)
                    .map_err(fail)?;
            }
            Some(Operation::Throw) => {
                linker
                    .func_wrap(
                        &namespace,
                        &name,
                        |caller: Caller<'_, Page>,
                         pointer: i32,
                         length: i32|
                         -> Result<(), wasmi::Error> {
                            Err(wasmi::Error::new(string_at(&caller, pointer, length)))
                        },
                    )
                    .map_err(fail)?;
            }
            None => {
                return Err(Failure(format!(
                    "the probe file imports {namespace}.{name}, which the check does not emulate"
                )));
            }
        }
    }
    Ok(linker)
}

/// Whether `memory` holds the marker anywhere.
fn holds_marker(memory: &[u8]) -> bool {
    holds(memory, MARKER)
}

/// Whether `memory` holds `bytes` anywhere.
fn holds(memory: &[u8], bytes: &[u8]) -> bool {
    memory.windows(bytes.len()).any(|window| window == bytes)
}

/// An instance of `module` with the glue's imports emulated, and its memory.
fn started(
    engine: &Engine,
    module: &Module,
    glue: &str,
    malloc: &str,
) -> Result<(Store<Page>, Instance, Memory), Failure> {
    let mut store = Store::new(engine, Page::default());
    let instance = linker(engine, module, glue, malloc)?
        .instantiate_and_start(&mut store, module)
        .map_err(wasm_error)?;
    let memory: Memory = instance
        .get_memory(&store, "memory")
        .ok_or_else(|| Failure("the probe file exports no memory".to_owned()))?;
    Ok((store, instance, memory))
}

/// The probe file's problems: a marker left after an entry, a secret left by the entries, or a
/// refusal that reaches the page otherwise than TS's does.
pub(super) fn problems(bytes: &[u8], glue: &str) -> Result<Vec<String>, Failure> {
    let engine = Engine::default();
    let module = Module::new(&engine, bytes).map_err(wasm_error)?;
    let malloc_name = glue
        .split("passArray8ToWasm0(marker, wasm.")
        .nth(1)
        .and_then(|rest| rest.split(')').next())
        .ok_or_else(|| Failure("the glue names no allocator for the probes".to_owned()))?;
    let mut problems = entry_problems(&engine, &module, glue, malloc_name)?;
    let (mut store, instance, memory) = started(&engine, &module, glue, malloc_name)?;
    let malloc = instance
        .get_typed_func::<(i32, i32), i32>(&store, malloc_name)
        .map_err(wasm_error)?;
    // The search finds a marker where it lies: in the last bytes of the memory, then zeroed again.
    {
        let data = memory.data_mut(&mut store);
        let at = data.len() - MARKER.len() - 1;
        let kept = data[at..at + MARKER.len()].to_vec();
        data[at..at + MARKER.len()].copy_from_slice(MARKER);
        let found = holds_marker(data);
        data[at..at + MARKER.len()].copy_from_slice(&kept);
        if !found {
            return Err(Failure(
                "the memory scan cannot find a marker written into the memory".to_owned(),
            ));
        }
    }
    problems.extend(row_problems(&mut store, &instance, &memory)?);
    let length = i32::try_from(MARKER.len()).unwrap_or(0);
    // probeShares takes the marker's first 32 bytes as a secret: those are searched for.
    for (entry, scanned) in [
        ("probeFreed", MARKER.len()),
        ("probeGrown", MARKER.len()),
        ("probeStack", MARKER.len()),
        ("probeShares", SECRET_BYTES),
    ] {
        let pointer = malloc.call(&mut store, (length, 1)).map_err(wasm_error)?;
        let start = usize::try_from(pointer).unwrap_or(0);
        memory.data_mut(&mut store)[start..start + MARKER.len()].copy_from_slice(MARKER);
        let probe = instance
            .get_typed_func::<(i32, i32), ()>(&store, entry)
            .map_err(wasm_error)?;
        probe
            .call(&mut store, (pointer, length))
            .map_err(wasm_error)?;
        if holds(memory.data(&store), &MARKER[..scanned]) {
            problems.push(format!("{entry} left its marker in the memory"));
        }
    }
    let marker = store
        .data_mut()
        .add(Object::Text(String::from_utf8_lossy(MARKER).into_owned()));
    instance
        .get_typed_func::<i32, ()>(&store, "probeText")
        .map_err(wasm_error)?
        .call(&mut store, marker)
        .map_err(wasm_error)?;
    if holds_marker(memory.data(&store)) {
        problems.push("probeText left its marker in the memory".to_owned());
    }
    problems.extend(refusal_problems(&mut store, &instance, &memory)?);
    Ok(problems)
}

/// The depth of the data under `top`, the stack's pointer, of what the stack below it holds once
/// painted: the lowest byte that is neither the paint nor a zero of a scrub.
fn data_depth(stack: &[u8]) -> usize {
    let lowest = stack.iter().position(|byte| *byte != PAINT && *byte != 0);
    stack.len() - lowest.unwrap_or(stack.len())
}

/// The painted stack of an instance, below its pointer now.
fn painted_stack(
    store: &mut Store<Page>,
    instance: &Instance,
    memory: &Memory,
) -> Result<std::ops::Range<usize>, Failure> {
    let top = instance
        .get_typed_func::<i32, i32>(&*store, "__wbindgen_add_to_stack_pointer")
        .map_err(wasm_error)?
        .call(&mut *store, 0)
        .map_err(wasm_error)?;
    let top = usize::try_from(top).unwrap_or(0);
    let bottom = top
        .checked_sub(PAINTED_BYTES)
        .ok_or_else(|| Failure("the probe file's stack is too small to paint".to_owned()))?;
    memory.data_mut(&mut *store)[bottom..top].fill(PAINT);
    Ok(bottom..top)
}

/// What the export `entry` gives, a number.
fn number_of(store: &mut Store<Page>, instance: &Instance, entry: &str) -> Result<usize, Failure> {
    let number = instance
        .get_typed_func::<(), i32>(&*store, entry)
        .map_err(wasm_error)?
        .call(&mut *store, ())
        .map_err(wasm_error)?;
    Ok(usize::try_from(number).unwrap_or(0))
}

/// Each row of the library's self-check, run on a painted stack: a row that fails, that leaves
/// data as deep as the scrub reaches, or whose seed a scrub leaves on the stack. Zeros are no data:
/// the share engine scrubs by itself.
fn row_problems(
    store: &mut Store<Page>,
    instance: &Instance,
    memory: &Memory,
) -> Result<Vec<String>, Failure> {
    let scrub = number_of(store, instance, "probeScrubBytes")?;
    let count = number_of(store, instance, "probeRowCount")?;
    let row = instance
        .get_typed_func::<i32, i32>(&*store, "probeRow")
        .map_err(wasm_error)?;
    let scrubbing = instance
        .get_typed_func::<(), ()>(&*store, "probeScrub")
        .map_err(wasm_error)?;
    let mut problems = Vec::new();
    let mut deepest = 0;
    for place in 0..i32::try_from(count).unwrap_or(0) {
        let stack = painted_stack(store, instance, memory)?;
        if row.call(&mut *store, place).map_err(wasm_error)? == 0 {
            problems.push(format!("row {place} of the self-check failed"));
        }
        let depth = data_depth(&memory.data(&*store)[stack.clone()]);
        if depth >= scrub {
            problems.push(format!(
                "row {place} of the self-check reaches {depth} bytes of the stack, the scrub {scrub}"
            ));
        }
        deepest = deepest.max(depth);
        scrubbing.call(&mut *store, ()).map_err(wasm_error)?;
        if holds(&memory.data(&*store)[stack], ROW_SEED) {
            problems.push(format!("a scrub left the seed of row {place} on the stack"));
        }
    }
    if holds(memory.data(&*store), ROW_SEED) {
        problems.push("the rows left their seed in the memory".to_owned());
    }
    println!("wasm: {count} rows went {deepest} bytes down the stack, the scrub {scrub}");
    Ok(problems)
}

/// probeRefusal's error as a page receives it.
fn refusal_problems(
    store: &mut Store<Page>,
    instance: &Instance,
    memory: &Memory,
) -> Result<Vec<String>, Failure> {
    let stack = instance
        .get_typed_func::<i32, i32>(&*store, "__wbindgen_add_to_stack_pointer")
        .map_err(wasm_error)?;
    let refusal = instance
        .get_typed_func::<i32, ()>(&*store, "probeRefusal")
        .map_err(wasm_error)?;
    let pointer = stack.call(&mut *store, -16).map_err(wasm_error)?;
    refusal.call(&mut *store, pointer).map_err(wasm_error)?;
    let start = usize::try_from(pointer).unwrap_or(0);
    let word = |at: usize| {
        let bytes = memory
            .data(&*store)
            .get(at..at + 4)
            .and_then(|slice| <[u8; 4]>::try_from(slice).ok());
        bytes.map_or(0, i32::from_le_bytes)
    };
    let (object, thrown) = (word(start), word(start + 4));
    stack.call(&mut *store, 16).map_err(wasm_error)?;
    let mut problems = Vec::new();
    if thrown == 0 {
        problems.push("probeRefusal threw nothing".to_owned());
        return Ok(problems);
    }
    let expected = format!("{{\"value\":\"{REFUSAL_CODE}\",\"enumerable\":true}}");
    match store.data().get(object) {
        Some(Object::Error {
            kind,
            message,
            properties,
        }) => {
            if *kind != "RangeError" {
                problems.push(format!("probeRefusal threw a {kind}, not a RangeError"));
            }
            if message != REFUSAL_MESSAGE {
                problems.push("probeRefusal's message differs".to_owned());
            }
            if properties.as_slice() != [("code".to_owned(), expected)] {
                problems.push(format!(
                    "probeRefusal's code is defined as {properties:?}, not enumerable and read-only"
                ));
            }
        }
        _ => problems.push("probeRefusal threw no error object".to_owned()),
    }
    Ok(problems)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_is_what_is_neither_paint_nor_a_scrub() {
        assert_eq!(data_depth(&[PAINT, PAINT, 0, 0]), 0);
        assert_eq!(data_depth(&[PAINT, 7, 0, 0]), 3);
    }

    #[test]
    fn the_glue_imports_are_read_by_their_code() {
        let glue = "        __wbg_new_1: function(arg0, arg1) {\n            const ret = new RangeError(getStringFromWasm0(arg0, arg1));\n        __wbg_parse_2: function(arg0, arg1) {\n            const ret = JSON.parse(getStringFromWasm0(arg0, arg1));\n";
        assert_eq!(
            imports_of(glue),
            vec![
                ("__wbg_new_1".to_owned(), Operation::NewError("RangeError")),
                ("__wbg_parse_2".to_owned(), Operation::Parse)
            ]
        );
    }
}
