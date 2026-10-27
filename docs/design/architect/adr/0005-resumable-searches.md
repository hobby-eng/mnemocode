# Searches are resumable and the host steps them

## Context

The date, word and marked-code searches, the joint share search and share unmasking run up to
2^24 candidates (2^31 date combinations) with a PBKDF2 wallet check each. TS yields to the event
loop every 50 ms and stops on an AbortSignal (CAP-RECOVERY-SEARCH-TURNS). A synchronous WASM call
cannot hear a stop message: the page's event loop does not run during it, and SharedArrayBuffer
needs COOP and COEP, which a page opened as a file cannot send (platform report, B-COOP-COEP). A
stop must give a visibly partial result (CORE-22); work must be bounded (CORE-50). TS times a
sample of public work before the person consents and before any candidate is checked: 3 wallet
checks on `abandon … about` and 256 decodings of a public phrase of the same length
(CAP-RECOVERY-DATE-SEARCH), 10,000 digest checks on zero bytes (CAP-SSKR-REPAIR-REPORT).

## Decision

```rust
pub trait Search {
    type Outcome;
    type Error: Refusal;
    /// Runs part `part` of the TS pace sample, on public data only, for the host to time
    /// before consent; `SearchSize` says how many parts there are.
    fn pace_sample(&self, part: u8) -> Result<(), Self::Error>;
    /// Checks at most `work` candidates, then returns.
    fn step(&mut self, work: u32) -> Result<Step, Self::Error>;
    /// The outcome so far; partial unless the last step finished.
    fn finish(self) -> Self::Outcome;
    fn size(&self) -> SearchSize;
}
```

The host times each part of the pace sample and passes the times to `search::plan`, which gives
the time estimate and whether to ask; no secret candidate is checked before consent. The host then
drives: the CLI loops until done or Ctrl+C, the page calls `step` from its own turns or a worker.
The library reads no clock.

## Rejected alternatives

- A blocking search with progress and stop callbacks: works natively, not in a synchronous WASM
  call.
- A search in a Worker stopped by `terminate()`: loses the partial result.
- Async Rust: an executor for a CPU loop, and every API async.
- Measuring the pace on the first steps: secret candidates would be checked before the person
  consents, and the estimate would differ from TS's (RUST-14).

## Consequences

- Every search keeps its position as state; one CLI loop and one JS loop serve all of them.
- Progress lines, consent and stopping are front-end code over one interface; their texts stay
  RUST-14 results.
