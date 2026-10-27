# Design of the Rust MnemoCode

The architecture of the Rust port of MnemoCode TS 0.1.0 (commit `7d0d4ee`), written before its
code and kept as the record the code is checked against (owner's request of 2026-10-26: a modular
design built once, with every rule of the coding guide gated from the first commit).

- `architect/`: the architecture (`ARCHITECTURE.md`), the threat model, the gates of every coding
  rule (`GATES.md`), the plan of increments with the owner's decisions (`PLAN.md`), the decisions
  that are costly to change (`adr/`), and where each of the 244 capabilities of TS 0.1.0 goes
  (`mapping.json`). The module map is the repository's `module-map.json`.
- `platform/`: the protections of each system, with their threats, calls, read-backs and sources.
- `crates/`: the runtime crates and why each was chosen.
- `assess/`: the assessment of the earlier Rust attempt, which this design replaced.

The reports cite their evidence as paths of the design's working folder (`work/`, `skeptic/`,
`probe-netns/` and others under `tmp/rust-arch/` of the owner's workspace): probes, build logs and
downloaded sources that stay outside the repository. Paths of other repositories (`mhfe/…`,
`multi-chain-wallet-tools/…`, `mnemocode/…` for TS 0.1.0) are relative to that workspace.
