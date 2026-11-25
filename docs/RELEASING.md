# Releasing MnemoCode

A release is built and checked on GitHub and signed on the maintainer's computer. The OpenPGP key
never enters GitHub Actions.

## Release notes

Write `docs/releases/v<version>.md`. It becomes the text of the release; a tag without it stops the
release workflow before anything is built. In `CHANGELOG.md`, the version's heading loses its
`(unreleased)`.

## Version

Set the version in the workspace's `Cargo.toml` and run `cargo update --workspace`, so that
`Cargo.lock` follows it.

## Checks before the tag

Run the release-level checks, one at a time:

```sh
cargo xtask check
cargo xtask release build x86_64-unknown-linux-gnu
cargo xtask verify-executable dist/release/mnemocode-<version>-linux-x64
```

Then measure the line coverage of the tests on Linux with cargo-llvm-cov, using the same tests as
`cargo xtask check`, and record it. `docs/COVERAGE.md` gives the revision, the fingerprint of the
measured sources, the command, the totals for each crate and what the measurement leaves out. The
README states the total and links to that document. The command-line binary closes its own file
access once its protections are on, so write the profile continuously: set
`RUSTFLAGS="-C llvm-args=-runtime-counter-relocation"` and put `%c` in `LLVM_PROFILE_FILE`. Without
that, the command-line tests lose their counters, and one of them fails on the profiler's error
message.

The canonical Dockerfile accepts an optional `CARGO_BUILD_JOBS` build argument. Set it with
`docker buildx build --build-arg CARGO_BUILD_JOBS=<jobs> ...` to choose Cargo parallelism for
toolchain installation and artifact compilation within the machine's available memory.

## Signed tag

Make an annotated tag, signed like the commits with the SSH key that Git is set up with, and push
it:

```sh
TZ=UTC git tag -s v<version> -m "MnemoCode <version>"
git cat-file -p v<version>
git push origin v<version>
```

`git cat-file -p` must show an SSH signature at the end of the tag.

## The release workflow

The tag runs `.github/workflows/release.yml`: the executables for Linux and Windows and every
page's WebAssembly file in the canonical container (`packaging/Dockerfile.reproducible`), a second
build from no cache compared byte for byte (`cargo xtask reproducible`), the macOS executables on
macOS runners, each of the five executables run on its own system, `cargo xtask features`, every
check of CI on the tagged commit, then a draft release with `SHA256SUMS` and build attestations. The
imports of the Windows executable are checked on the file that ships. Run by hand on another commit
(`workflow_dispatch`), the workflow does the same and makes no draft. To compare a release with a
build of your own, run `cargo xtask reproducible` on the tagged commit with its files in
`dist/release/`; it leaves out the `.sha256` files of the jobs, which a release does not hold.

## Signing

On the maintainer's computer, with the release key in GnuPG and `gh` logged in:

```sh
cargo xtask sign v<version>
cargo xtask sign v<version> --publish
```

`cargo xtask sign` needs the tag in this clone and a `gh` whose `attestation verify` takes
`--source-digest` (2.104.0 does). It refuses a draft of more than 32 files or with a file over 512
MiB and downloads it into `release-signing-v<version>/`. `SHA256SUMS` must list exactly the eleven
files of a release, each once: the five executables, their five licence files and
`mnemocode-<version>-wasm.tar`; the draft may hold nothing else but an earlier run's signature and
key. Every file must match `SHA256SUMS`. The tag here must name the same commit as GitHub's tag, and
every file and `SHA256SUMS` must have a build attestation of the release workflow for that tag and
commit, made on a GitHub-hosted runner. The task then signs `SHA256SUMS`, checks the signature and
uploads it with the public key. GnuPG asks for the passphrase in the terminal; the task never reads
a private key. Move the folder away before you run it again. The key's fingerprint is
`28FC 51B1 DB80 DF21 0112  8CB3 0EDD 4814 591D D095`.

The wallet-tools pages take their WebAssembly files from `mnemocode-<version>-wasm.tar`.
