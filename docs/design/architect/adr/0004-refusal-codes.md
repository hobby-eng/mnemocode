# Refusals keep the codes and messages of TS 0.1.0

## Context

Hosts tell refusals apart by stable codes (CAP-PHRASE-FORMATS-REFUSAL-CODES, CORE-23); wallet-tools
pages and recorded scripts depend on them; RUST-14 keeps formats, messages and options unless the
owner decides otherwise. RUST-04 asks for an error type per module whose `Display` is the one place
its messages are written. The TS has odd codes (`missing-checksum`,
`assert-calendar-date-refused-2`, bare `answer-too-long`) and catalog checks against its own data.

## Decision

A `Refusal` trait (`code() -> &'static str`) over `std::error::Error`. One enum per module, one
variant per condition; `code()` gives the TS string, `Display` the TS message byte for byte; a
variant holds positions, counts and option names, never typed text.
`vectors/ts-0.1.0/refusals-v1.json`, recorded from 7d0d4ee, lists every TS code with a sample
message, or the reason it is gone; tests compare each variant with it and check that codes are
unique across all enums. The CLI prints
`✗ Error: <Display>`; the binding returns `{ code, message }` from one function.

## Rejected alternatives

- New, consistent codes: breaks wallet-tools pages and RUST-14 without the owner's decision.
- One crate-wide error enum: a host could not take a module alone (RUST-04).
- Messages built in the front ends: two sources (CORE-10).

## Consequences

- Codes that guarded JavaScript types or the program's own data are not written; the file records
  each of them.
- Renaming a code, or fixing an odd message, is an owner decision applied in one place, the
  module's `code()` or `Display`. On 2026-10-27 the owner took such fixes, made in the TS first
  (`mapping.json`, defects "Decided"): `missing-checksum` gets its namespace (CORE-23), the two
  calendar codes say year and month, three messages are reworded, and the decided fixes add refusals (a new code where the fix names
  one), each recorded in `refusals-v1.json` from the TS commit that adds it.
- The port adds codes for conditions TS cannot meet, each in the library and in
  `refusals-v1.json` as the port's own: `core.secret.capacity-exceeded` (a secret larger than the
  buffer reserved for it), `core.random.unavailable` (the host's random source failed) and
  `core.random.empty-range` (a uniform choice below 0).
- Each refusal keeps TS's kind of JavaScript error (`Refusal::kind`: `Error`, `RangeError`,
  `TypeError`), which the recordings hold beside the code and message.
- The bip39 crate's errors and English messages never reach a host: the `bip39` module checks the
  count and each word first and maps a failed checksum to the caller's TS code;
  `core.master-fingerprint.invalid-mnemonic` and the host-PBKDF2 codes are recorded as gone, since
  the seed takes a validated phrase.
