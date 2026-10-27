//! The test profile's checks of the binding itself (B-WIPE), run on the built file in wasmi, an
//! interpreter of WebAssembly written in Rust: each probe entry takes a public marker the way a
//! secret entry takes a secret, and afterwards the instance's whole memory is searched for it; the
//! search is first shown to find a marker written into the memory. A refusal is followed through
//! the glue's imports, which are emulated from their code in the glue (`new RangeError(…)`,
//! `JSON.parse(…)`, `Object.defineProperty(…)`): it must reach a page as TS's kind of error, with
//! its message and a `code` defined enumerable and neither writable nor configurable.

use wasmi::{Caller, Engine, Linker, Memory, Module, Store};

use crate::Failure;

/// The public marker the probes take.
const MARKER: &[u8] = b"public marker of the MnemoCode memory scan, 0123456789";
/// The refusal probeRefusal throws (crates/mnemocode-wasm/src/probe.rs).
const REFUSAL_CODE: &str = "core.pieces.piece-whole-width-at-least-1";
const REFUSAL_MESSAGE: &str = "A piece needs a whole width of at least 1.";
/// The glue's first free slot of its object heap: 1024 slots, then undefined, null, true, false.
const HEAP_START: usize = 1028;

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
}

/// The emulated page: its objects by index.
#[derive(Debug, Default)]
struct Page {
    heap: Vec<Option<Object>>,
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
        let operation = if body.contains("new RangeError(") {
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

/// A linker that gives every import of `module` the operation the glue gives it; one the probes
/// need not run traps.
fn linker(engine: &Engine, module: &Module, glue: &str) -> Result<Linker<Page>, Failure> {
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
                linker
                    .func_wrap(
                        &namespace,
                        &name,
                        |mut caller: Caller<'_, Page>, pointer: i32, length: i32| {
                            let text = string_at(&caller, pointer, length);
                            caller.data_mut().add(Object::Json(text))
                        },
                    )
                    .map_err(fail)?;
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
    memory.windows(MARKER.len()).any(|window| window == MARKER)
}

/// The probe file's problems: a marker left after an entry, or a refusal that reaches the page
/// otherwise than TS's does.
pub(super) fn problems(bytes: &[u8], glue: &str) -> Result<Vec<String>, Failure> {
    let wasm_error = |error: wasmi::Error| Failure(format!("wasmi: {error}"));
    let engine = Engine::default();
    let module = Module::new(&engine, bytes).map_err(wasm_error)?;
    let mut store = Store::new(&engine, Page::default());
    let instance = linker(&engine, &module, glue)?
        .instantiate_and_start(&mut store, &module)
        .map_err(wasm_error)?;
    let memory: Memory = instance
        .get_memory(&store, "memory")
        .ok_or_else(|| Failure("the probe file exports no memory".to_owned()))?;
    let malloc_name = glue
        .split("passArray8ToWasm0(marker, wasm.")
        .nth(1)
        .and_then(|rest| rest.split(')').next())
        .ok_or_else(|| Failure("the glue names no allocator for the probes".to_owned()))?;
    let malloc = instance
        .get_typed_func::<(i32, i32), i32>(&store, malloc_name)
        .map_err(wasm_error)?;
    let mut problems = Vec::new();
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
    let length = i32::try_from(MARKER.len()).unwrap_or(0);
    for entry in ["probeFreed", "probeGrown", "probeStack"] {
        let pointer = malloc.call(&mut store, (length, 1)).map_err(wasm_error)?;
        let start = usize::try_from(pointer).unwrap_or(0);
        memory.data_mut(&mut store)[start..start + MARKER.len()].copy_from_slice(MARKER);
        let probe = instance
            .get_typed_func::<(i32, i32), ()>(&store, entry)
            .map_err(wasm_error)?;
        probe
            .call(&mut store, (pointer, length))
            .map_err(wasm_error)?;
        if holds_marker(memory.data(&store)) {
            problems.push(format!("{entry} left its marker in the memory"));
        }
    }
    problems.extend(refusal_problems(&mut store, &instance, &memory)?);
    Ok(problems)
}

/// probeRefusal's error as a page receives it.
fn refusal_problems(
    store: &mut Store<Page>,
    instance: &wasmi::Instance,
    memory: &Memory,
) -> Result<Vec<String>, Failure> {
    let wasm_error = |error: wasmi::Error| Failure(format!("wasmi: {error}"));
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
