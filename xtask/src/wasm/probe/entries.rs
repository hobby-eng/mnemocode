//! The secret entries of the binding, searched: in an instance of its own, `probeEntries` tells
//! each secret it meets on public secrets of two lengths: phrases, seeds, keys, dates, masks, shares
//! and their bytes; the search must find its texts there, or it proves nothing. In another instance
//! it calls every secret entry on the same secrets as a page does, with no scrub but the entry's
//! own: after each return of an entry (the import `probeEntryReturned`) none of them may lie on the
//! stack, the paint laid under the entry must be gone from what its scrub reaches, which shows the
//! scrub ran whatever form a secret took, and after the last none may lie in the memory, as bytes
//! or as text, in part or whole.

use std::collections::{HashMap, HashSet};

use wasmi::{Caller, Engine, Instance, Memory, Module, Store};

use super::{
    Object, PAINT, Page, RANDOM_SEARCHED, data_depth, number_of, painted_stack, random_bytes,
    started, string_at, wasm_error,
};
use crate::Failure;

/// The public phrases that the entries take as a page's strings, of 16 and 32 bytes that rise from
/// 0xA0 by 3: occurring nowhere else.
const ENTRY_PHRASES: [&str; 2] = [
    "pass brush price flock will food title jelly scrub change verify old",
    "pass brush price flock will food title jelly scrub change verify option artwork twin guess orbit title consider depend target butter know typical phone",
];
/// The BIP39 passphrase that the entries take so.
const ENTRY_PASSPHRASE: &str = "zq4-public-salt-of-the-scan-7h";
/// The dates that the phrases are masked with, and how `Dates` holds them: sorted.
const ENTRY_DATES: &str = "23-09-2026 01-02-2001";
const ENTRY_DATE_BYTES: [u8; 8] = [0x07, 0xd1, 2, 1, 0x07, 0xea, 9, 23];
/// The key that the WIF holds: its bytes rise from 0x13 by 7, as no table of the file does.
const ENTRY_KEY_START: u8 = 0x13;
const ENTRY_KEY_STEP: u8 = 7;
/// The steps of entries that hold no secret and so no scrub: a page's free, and public text.
const UNSCRUBBED_STEPS: [&str; 7] = [
    "drop of a backup",
    "drop of a list",
    "drop of a split",
    "drop of a restore",
    "fingerprint evidence",
    "keeping note",
    "unchecked note",
];
/// The frame around a scrub, at both ends of what it reaches, which the check leaves out.
const SCRUB_FRAME_BYTES: usize = 1024;
/// The data that a scrubbed entry leaves under its caller: the frame that called the scrub.
const SCRUBBED_DATA_BYTES: usize = 128;
/// The fewest secrets that the entries tell: a phrase's and its shares'.
const LEAST_TOLD: usize = 100;
/// The public WIF that they take so.
const ENTRY_WIF: &str = "KwrqqTFcxWz9TRFAoo4vMomMovpLxdGHL2kQy5YjUjFVy12a5zEX";
/// The fewest bytes of a secret searched for together: a freed block keeps all but its first bytes
/// where an allocator overwrites them, so a part is looked for too.
const WINDOW_BYTES: usize = 8;
/// The fewest letters of a text searched for together: more than the longest word of a list, which
/// lies in the file as it is.
const WINDOW_LETTERS: usize = 16;

/// One secret the entries met, as they told it.
#[derive(Debug, PartialEq, Eq)]
enum Secret {
    Bytes(Vec<u8>),
    Text(String),
}

impl Secret {
    /// Its start: public, as all that the entries are given.
    fn start(&self) -> String {
        match self {
            Self::Bytes(bytes) => bytes
                .iter()
                .take(WINDOW_BYTES)
                .map(|byte| format!("{byte:02x}"))
                .collect(),
            Self::Text(text) => text.chars().take(WINDOW_LETTERS).collect(),
        }
    }
}

/// The starts of the secrets at `places`.
fn starts_of(places: &[usize], secrets: &[Secret]) -> String {
    let starts: Vec<String> = places
        .iter()
        .filter_map(|&place| secrets.get(place))
        .map(Secret::start)
        .collect();
    starts.join(", ")
}

/// What `probeEntries` told.
#[derive(Debug, Default)]
struct Told {
    secrets: Vec<Secret>,
    /// The candidate lists, in hexadecimal.
    lists: Vec<String>,
    /// The steps of the entries that did not answer as they should.
    refused: Vec<String>,
}

/// The bytes of `digits`.
fn bytes_of(digits: &str) -> Vec<u8> {
    digits
        .as_bytes()
        .chunks(2)
        .filter_map(|pair| std::str::from_utf8(pair).ok())
        .filter_map(|pair| u8::from_str_radix(pair, 16).ok())
        .collect()
}

/// What `told`, as `probeEntries` writes it, holds.
fn told_of(told: &str) -> Told {
    let mut read = Told::default();
    for line in told.lines() {
        let secret = match line.split_once(' ') {
            Some(("b", digits)) => Secret::Bytes(bytes_of(digits)),
            Some(("t", text)) => Secret::Text(text.to_owned()),
            Some(("l", digits)) => {
                read.lists.push(digits.to_owned());
                continue;
            }
            Some(("!", step)) => {
                read.refused.push(step.to_owned());
                continue;
            }
            _ => continue,
        };
        if !read.secrets.contains(&secret) {
            read.secrets.push(secret);
        }
    }
    read
}

/// The parts of the secrets that are searched for, each with its secret's place: bytes
/// [`WINDOW_BYTES`] at a time, text [`WINDOW_LETTERS`].
#[derive(Debug)]
struct Parts {
    bytes: HashMap<[u8; WINDOW_BYTES], usize>,
    letters: HashMap<[u8; WINDOW_LETTERS], usize>,
}

/// The parts of `of` secrets, `WINDOW` bytes long.
fn windows_of<'a, const WINDOW: usize>(
    of: impl Iterator<Item = (usize, &'a [u8])>,
) -> HashMap<[u8; WINDOW], usize> {
    let mut parts = HashMap::new();
    for (place, secret) in of {
        for window in secret.windows(WINDOW) {
            if let Ok(part) = <[u8; WINDOW]>::try_from(window) {
                parts.insert(part, place);
            }
        }
    }
    parts
}

impl Parts {
    /// The parts of `secrets`, but for those that `file`, a fresh instance's memory, holds: public,
    /// as a table or the start of every share.
    fn of(secrets: &[Secret], file: &[u8]) -> Self {
        let bytes = secrets
            .iter()
            .enumerate()
            .filter_map(|(place, secret)| match secret {
                Secret::Bytes(bytes) => Some((place, bytes.as_slice())),
                Secret::Text(_) => None,
            });
        let letters = secrets
            .iter()
            .enumerate()
            .filter_map(|(place, secret)| match secret {
                Secret::Bytes(_) => None,
                Secret::Text(text) => Some((place, text.as_bytes())),
            });
        let mut parts = Self {
            bytes: windows_of(bytes),
            letters: windows_of(letters),
        };
        for window in file.windows(WINDOW_BYTES) {
            parts.bytes.remove(window);
        }
        for window in file.windows(WINDOW_LETTERS) {
            parts.letters.remove(window);
        }
        parts
    }

    /// Adds to `left` the places of the secrets of which `memory` holds a part.
    fn find(&self, memory: &[u8], left: &mut Vec<usize>) {
        for window in memory.windows(WINDOW_LETTERS) {
            let Some(start) = window.first_chunk::<WINDOW_BYTES>() else {
                continue;
            };
            if *start == [0; WINDOW_BYTES] || *start == [PAINT; WINDOW_BYTES] {
                continue;
            }
            let found = self.bytes.get(start).or_else(|| {
                window
                    .first_chunk::<WINDOW_LETTERS>()
                    .and_then(|part| self.letters.get(part))
            });
            if let Some(&place) = found
                && !left.contains(&place)
            {
                left.push(place);
            }
        }
    }
}

/// What the gate does at each return of an entry: it looks at the stack below the entries.
#[derive(Debug)]
pub(super) struct Watch {
    parts: Parts,
    /// The lowest address painted.
    bottom: usize,
    /// How many entries returned.
    entries: usize,
    /// How far the scrub of `after_secret` reaches.
    scrub: usize,
    /// The steps after which a new secret lay on the stack.
    left_by: Vec<String>,
    /// The steps whose scrub did not run, or that ran one that `UNSCRUBBED_STEPS` says they lack.
    misplaced: Vec<String>,
    /// How deep the data of any entry lay.
    deepest: usize,
    /// The places of the secrets found on the stack.
    left: Vec<usize>,
}

/// Whether a scrub ran over `stack`, painted before the entry: what it reaches holds only zeros,
/// and data lies no deeper than the frame that called it.
fn scrubbed(stack: &[u8], scrub: usize) -> bool {
    let end = stack.len();
    let band = &stack[end - scrub + SCRUB_FRAME_BYTES..end - SCRUB_FRAME_BYTES];
    band.iter().all(|byte| *byte == 0) && data_depth(stack) <= SCRUBBED_DATA_BYTES
}

/// The import `probeEntryReturned`: the stack that the entry of `step` left, searched.
pub(super) fn entry_returned(
    mut caller: Caller<'_, Page>,
    step: i32,
    length: i32,
) -> Result<(), wasmi::Error> {
    let step = string_at(&caller, step, length);
    let top = caller
        .get_export("__wbindgen_add_to_stack_pointer")
        .and_then(wasmi::Extern::into_func)
        .ok_or_else(|| wasmi::Error::new("the probe file exports no stack pointer"))?
        .typed::<i32, i32>(&caller)?
        .call(&mut caller, 0)?;
    let memory = caller
        .get_export("memory")
        .and_then(wasmi::Extern::into_memory)
        .ok_or_else(|| wasmi::Error::new("the probe file exports no memory"))?;
    let (data, page) = memory.data_and_store_mut(&mut caller);
    if let Some(watch) = &mut page.watch {
        watch.entries += 1;
        let before = watch.left.len();
        let top = usize::try_from(top).unwrap_or(0);
        // A window that starts under the top may end above it.
        let searched = &data[watch.bottom..top + WINDOW_LETTERS - 1];
        watch.parts.find(searched, &mut watch.left);
        let stack = &mut data[watch.bottom..top];
        watch.deepest = watch.deepest.max(data_depth(stack));
        // An entry of `UNSCRUBBED_STEPS` keeps the paint, so that the check is seen to fail.
        let listed = UNSCRUBBED_STEPS.contains(&step.as_str());
        if scrubbed(stack, watch.scrub) == listed && !watch.misplaced.contains(&step) {
            watch.misplaced.push(step.clone());
        }
        if watch.left.len() > before {
            watch.left_by.push(step);
        }
        // Painted anew, so that the next entry's scrub shows, whatever form a secret takes.
        stack.fill(PAINT);
    }
    Ok(())
}

/// What `probeEntries` gives in the instance of `store`, `telling` or not, its string left in the
/// memory; and what frees it.
fn called_entries(
    store: &mut Store<Page>,
    instance: &Instance,
    memory: &Memory,
    telling: bool,
    given: String,
) -> Result<(String, i32, i32), Failure> {
    let adjust = instance
        .get_typed_func::<i32, i32>(&*store, "__wbindgen_add_to_stack_pointer")
        .map_err(wasm_error)?;
    let pointer = adjust.call(&mut *store, -16).map_err(wasm_error)?;
    let given = store.data_mut().add(Object::Text(given));
    instance
        .get_typed_func::<(i32, i32, i32), ()>(&*store, "probeEntries")
        .map_err(wasm_error)?
        .call(&mut *store, (pointer, i32::from(telling), given))
        .map_err(wasm_error)?;
    let at = usize::try_from(pointer).unwrap_or(0);
    let word = |place: usize| {
        memory
            .data(&*store)
            .get(place..place + 4)
            .and_then(|slice| <[u8; 4]>::try_from(slice).ok())
            .map_or(0, i32::from_le_bytes)
    };
    let (start, length) = (word(at), word(at + 4));
    adjust.call(&mut *store, 16).map_err(wasm_error)?;
    let (begin, count) = (
        usize::try_from(start).unwrap_or(0),
        usize::try_from(length).unwrap_or(0),
    );
    let text = String::from_utf8_lossy(&memory.data(&*store)[begin..begin + count]).into_owned();
    Ok((text, start, length))
}

/// The problems of the steps that did not answer as they should.
fn unanswered(told: &Told) -> Vec<String> {
    told.refused
        .iter()
        .map(|step| format!("probeEntries: {step} did not answer as it should"))
        .collect()
}

/// What `probeEntries` tells in an instance of its own: each secret, which must lie in the memory
/// while its own text does, so that a search that finds none shows.
fn told_by_entries(
    engine: &Engine,
    module: &Module,
    glue: &str,
    malloc: &str,
    given: &str,
) -> Result<(Told, Vec<String>), Failure> {
    let (mut store, instance, memory) = started(engine, module, glue, malloc)?;
    let (text, _, _) = called_entries(&mut store, &instance, &memory, true, given.to_owned())?;
    let told = told_of(&text);
    let mut problems = Vec::new();
    let parts = Parts::of(&told.secrets, &[]);
    let mut seen = Vec::new();
    parts.find(memory.data(&store), &mut seen);
    let texts: HashSet<usize> = parts.letters.values().copied().collect();
    let found = texts.iter().filter(|place| seen.contains(place)).count();
    if told.secrets.len() < LEAST_TOLD || found < texts.len() {
        problems.push(format!(
            "the scan found {found} of the {} texts of {} secrets it was told",
            texts.len(),
            told.secrets.len()
        ));
    }
    problems.extend(unanswered(&told));
    Ok((told, problems))
}

/// What the entries leave, in an instance of their own with no scrub but theirs: a secret on the
/// stack after an entry, one in the memory after the last, or data deeper than the scrub reaches.
pub(super) fn entry_problems(
    engine: &Engine,
    module: &Module,
    glue: &str,
    malloc: &str,
) -> Result<Vec<String>, Failure> {
    let given = format!(
        "{}\n{}\n{ENTRY_PASSPHRASE}\n{ENTRY_DATES}\n{ENTRY_WIF}",
        ENTRY_PHRASES[0], ENTRY_PHRASES[1]
    );
    let (told, mut problems) = told_by_entries(engine, module, glue, malloc, &given)?;
    let mut secrets = told.secrets;
    secrets.push(Secret::Bytes(random_bytes(RANDOM_SEARCHED)));
    let key = (0..32).map(|place| ENTRY_KEY_START + place * ENTRY_KEY_STEP);
    secrets.push(Secret::Bytes(key.collect()));
    secrets.push(Secret::Bytes(ENTRY_DATE_BYTES.to_vec()));
    let (mut store, instance, memory) = started(engine, module, glue, malloc)?;
    let parts = Parts::of(&secrets, memory.data(&store));
    let scrub = number_of(&mut store, &instance, "probeScrubBytes")?;
    let stack = painted_stack(&mut store, &instance, &memory)?;
    store.data_mut().watch = Some(Watch {
        parts,
        bottom: stack.start,
        entries: 0,
        scrub,
        left_by: Vec::new(),
        misplaced: Vec::new(),
        deepest: 0,
        left: Vec::new(),
    });
    let lists = told.lists.join("\n");
    let (text, _, _) = called_entries(
        &mut store,
        &instance,
        &memory,
        false,
        format!("{given}\n{lists}"),
    )?;
    problems.extend(unanswered(&told_of(&text)));
    let watch = store
        .data_mut()
        .watch
        .take()
        .ok_or_else(|| Failure("the watch of the stack is gone".to_owned()))?;
    if !watch.misplaced.is_empty() {
        problems.push(format!(
            "these scrubs are not as they should be: {}",
            watch.misplaced.join(", ")
        ));
    }
    if !watch.left.is_empty() {
        problems.push(format!(
            "after {} of {} returns of entries, the stack held {}",
            watch.left_by.join(", "),
            watch.entries,
            starts_of(&watch.left, &secrets)
        ));
    }
    let depth = watch.deepest;
    if depth >= scrub {
        problems.push(format!(
            "the entries left data {depth} bytes down the stack, the scrub {scrub}"
        ));
    }
    let mut left = Vec::new();
    watch.parts.find(memory.data(&store), &mut left);
    if !left.is_empty() {
        problems.push(format!(
            "the entries left {} of {} secrets in the memory: {}",
            left.len(),
            secrets.len(),
            starts_of(&left, &secrets)
        ));
    }
    println!(
        "wasm: {} returns of entries searched for {} secrets; their data lies {depth} bytes down the stack, the scrub {scrub}",
        watch.entries,
        secrets.len()
    );
    Ok(problems)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_the_entries_tell_is_found_in_a_memory_that_holds_it() {
        let told = "b 0102030405060708090a\nt a phrase of many public words\nl 00ff\n! split\n";
        let Told {
            secrets,
            lists,
            refused,
        } = told_of(told);
        assert_eq!(refused, ["split"]);
        assert_eq!(lists, ["00ff"]);
        assert_eq!(
            secrets[0],
            Secret::Bytes(vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        );
        assert!(
            Parts::of(&secrets, &[0; 8]).bytes.len()
                > Parts::of(&secrets, &[3, 4, 5, 6, 7, 8, 9, 10]).bytes.len()
        );
        let parts = Parts::of(&secrets, &[]);
        let left_in = |memory: &[u8]| {
            let mut left = Vec::new();
            parts.find(memory, &mut left);
            left
        };
        let mut memory = vec![0_u8; 64];
        assert!(left_in(&memory).is_empty());
        memory[10..18].copy_from_slice(&[3, 4, 5, 6, 7, 8, 9, 10]);
        assert_eq!(left_in(&memory), [0]);
        let mut memory = vec![0_u8; 64];
        memory[20..36].copy_from_slice(&b"a phrase of many public words"[4..20]);
        assert_eq!(left_in(&memory), [1]);
        let mut memory = vec![0_u8; 64];
        memory[20..35].copy_from_slice(&b"a phrase of many public words"[4..19]);
        assert!(left_in(&memory).is_empty());
    }
}
