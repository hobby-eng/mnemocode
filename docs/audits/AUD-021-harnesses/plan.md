# AUD-021 coverage ownership

Expanded pre-release review of the unreleased architectural, backup-format and isolation changes. All checks use the canonical workspace procedure; source reasoning and runtime execution are distinct evidence. No reviewer may run tests, builds, renderers, Docker or heavy probes independently; the coordinator owns a single sequential execution queue.

| Check | Primary owner | Expected evidence |
| --- | --- | --- |
| CHECK-SEC-001 | Security reviewer | Secret source-to-owner-to-export map |
| CHECK-SEC-002 | Security reviewer | Node/OS restrictions and startup refusal traces |
| CHECK-SEC-003 | Security reviewer | Offline imports, network and child-process boundaries |
| CHECK-SEC-004 | Security reviewer | RNG, age encryption, authentication and failure paths |
| CHECK-SEC-005 | Security reviewer | Wiping, cancellation and exceptional-path review |
| CHECK-SEC-006 | Security reviewer | Host-neutral APIs; browser-specific applicability |
| CHECK-SEC-007 | Security reviewer | Input/search/image/work bounds |
| CHECK-FUN-001 | Recovery reviewer | Every BIP39 length, form and masking mode |
| CHECK-FUN-002 | Recovery reviewer | Fingerprint, address/network/path known answers |
| CHECK-FUN-003 | Recovery reviewer | Inapplicability of unimplemented standards |
| CHECK-FUN-004 | Recovery reviewer | Supported wallet-evidence subset and exclusions |
| CHECK-FUN-005 | Recovery reviewer | Transaction/PSBT inapplicability |
| CHECK-FUN-006 | Recovery reviewer | SSKR topology, repair, records and independent vectors |
| CHECK-FUN-007 | Recovery reviewer | Provider/accounting inapplicability |
| CHECK-API-001 | Interface reviewer | Public API/dependency/host contracts |
| CHECK-API-002 | Interface reviewer | Async snapshots, cancellation and late publication |
| CHECK-API-003 | Interface reviewer | Actual record/list/card schema and metadata |
| CHECK-API-004 | Interface reviewer | Encoding/QR/share interoperability boundaries |
| CHECK-BLD-001 | Coordinator | Toolchain, type/format checks and composition |
| CHECK-BLD-002 | Coordinator | Current Linux execution and explicit other-platform gaps |
| CHECK-BLD-003 | Coordinator | Dependency/advisory/package/license integrity |
| CHECK-BLD-004 | Coordinator | SSKR integrity and canonical build evidence |
| CHECK-BLD-005 | Coordinator | Executable, workflow, signatures and release gates |
| CHECK-UI-001 | Interface reviewer | Representative PDF/raster/QR export requirements |
| CHECK-UI-002 | Interface reviewer | Menu, private prompts and terminal navigation |
| CHECK-UI-003 | Interface reviewer | Warnings, reveal/clear, help links and QR input |
| CHECK-ARC-001 | Quality/documentation reviewer | Module ownership and host composition seams |
| CHECK-ARC-002 | Quality/documentation reviewer | Semantic duplication, unused paths and copy-gate limits |
| CHECK-ARC-003 | Quality/documentation reviewer | Test fidelity, casts, stale comments and startup coverage |
| CHECK-DOC-001 | Quality/documentation reviewer | Documentation against exact implementation |
| CHECK-DOC-002 | Quality/documentation reviewer | Examples, links, provenance and legal materials |
| CHECK-DOC-003 | Quality/documentation reviewer | Prior finding dispositions and audit evidence claims |

Wave 1 covers security and recovery correctness. An independent skeptic challenges its returned candidates before wave 2 interface work and wave 3 quality/documentation/release conclusions rely on them. Any authorized remediation would require a separate fourth verification wave; this baseline never silently fixes code. Each reviewer supplies scope, file hashes, concrete reproductions or proposed bounded probes, counterevidence, severity and remaining gaps. The coordinator challenges and reproduces accepted findings before issuing IDs.
