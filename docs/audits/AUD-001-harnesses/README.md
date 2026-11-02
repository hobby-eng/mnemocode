# AUD-001 harnesses

The audit-only programs behind [AUD-001](../README.md), the first audit of the Rust MnemoCode. They belong to the reviewed commit `b677647b477db276fef9003516f07270024124c3`. Each one uses public or synthetic data only: the public test phrase, and phrases from a fixed generator that no wallet holds. None of them is a member of the repository's workspace or part of a release; each is built on its own.

## `differential/`: the Rust program against the reference

`aud001-differential` makes synthetic phrases from a fixed generator and sends the same commands to the Rust executable and to a reference program, MnemoCode 0.1.0. Exit code, standard output, standard error and written files must be equal, for encoding in every mode and form, decoding, date and word searches, plaintext candidate lists and the word table. It also damages records and shares at random, in the ways a copy by hand or a scan does, and both programs must refuse or read them alike. Shares and QR images made by one program must be restored by the other.

Needs: the release executable, and the reference. The reference used here was the TS repository at `6f423d93`, built, with Node.js 26.12.1, but any command that starts MnemoCode 0.1.0 will do, such as its single executable.

```sh
cd docs/audits/AUD-001-harnesses/differential
cargo build --release
mkdir -p /path/to/work
target/release/aud001-differential /path/to/mnemocode /path/to/work 100 1001 node /path/to/mnemocode-ts/dist/mnemocode.js
```

The arguments are the executable, an existing work folder, the number of phrases, the generator's seed, and the reference's command. Each phrase prints a line with the cases so far and the differences so far. It exits 0 with no difference, 1 with any, and writes each difference to `differences.txt` in the work folder. As a control, a reference of `/bin/echo` must exit 1.

## `differential/src/bin/probes.rs`: the edges of the executable

`probes` runs the executable at what a file, a path or a person can do: the mode of a saved file, links as outputs, an output named as its input, a folder, `/dev/zero`, 64 MiB on standard input and bytes that are not UTF-8 as inputs, a phrase given as an argument, an option, a mode or a command, which must be refused and not repeated, and control characters in a path. It needs Unix.

```sh
target/release/probes /path/to/mnemocode /path/to/empty-folder
```

Each line says `ok` or `FAIL`. It ends with `all probes held` and exit 0, or with exit 1.

## `fuzz/`: the readers of what comes from outside

Three cargo-fuzz targets on the library: `text` (every reader of typed text, in every form and mode), `qr_png` (the reader of QR images) and `candidate_file` (the list's format, age with a published test identity, and the two key forms). They need a nightly toolchain and `cargo-fuzz`; the seed corpus is optional.

```sh
cargo +nightly fuzz run --fuzz-dir docs/audits/AUD-001-harnesses/fuzz text -- -max_total_time=300 -max_len=65536 -timeout=30
```

A crash or a timeout stops the run with a non-zero exit, and its input is saved under `artifacts/` of that folder.

## `browser/`: the page files in a real browser

`index.html` loads the `key-derivation` and `discovery-scanner` files of the multi-chain profile: every self-check at its full tier, a backup, a QR image written and read back, two splits that must differ, which uses the browser's `crypto.getRandomValues`, sample cards as PDF and PNG, and a refusal that must carry its code. `run.sh` drives one browser through WebDriver, with `serve` from `differential/` as a server on 127.0.0.1. It needs curl.

```sh
docs/audits/AUD-001-harnesses/browser/run.sh dist/wasm/multi-chain \
  /path/to/serve /path/to/chromedriver /path/to/chrome chrome /path/to/empty-folder
docs/audits/AUD-001-harnesses/browser/run.sh dist/wasm/multi-chain \
  /path/to/serve /path/to/geckodriver /path/to/firefox firefox /path/to/empty-folder
```

It prints one line per step, then `DONE`. It exits 0 when no line says `FAIL`, and 1 otherwise.

## `systems/`: the canonical files on other systems

`glibc-floor.sh` runs the Linux executable in `debian:11`, `ubuntu:22.04`, `debian:12`, `ubuntu:24.04` and `alpine:3.20`. Expected on the fix commit: `--version` and a `PASS` self-test without a loader's warning on the three newer glibc systems, and on Debian 11 and Alpine a refusal by the system. `other-systems.sh` runs the Windows executable under Wine and the ARM64 one under qemu-user in the pinned build image: version, self-test, encode, decode, split, combine and a card PDF. It exits 0 when each step ends well. `rebuild.sh`, from the root of a build with `dist/release`, runs the container's build stage again on the toolchain layers Docker kept, and compares every file.

```sh
docs/audits/AUD-001-harnesses/systems/glibc-floor.sh "$PWD/dist/release"
docs/audits/AUD-001-harnesses/systems/other-systems.sh "$PWD/dist/release"
docs/audits/AUD-001-harnesses/systems/rebuild.sh
```

They need Docker, and the first two download images. Wine and qemu-user do not prove what runs only on a real Windows or ARM computer.
