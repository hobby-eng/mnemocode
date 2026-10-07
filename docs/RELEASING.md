# Releasing MnemoCode

A release is built and checked on GitHub and signed on the maintainer's computer. The OpenPGP key never enters GitHub Actions: a tag only creates a draft release, `scripts/sign-release.mjs` checks the draft and signs it, and the maintainer then publishes it. The steps below run in this order.

## Release notes

In `CHANGELOG.md`, replace "(unreleased)" in the version's heading with the release date, for example `## 0.1.0 (2026-10-07)`: the release notes link to `CHANGELOG.md` at the tag.

Write `docs/releases/v<version>.md` from the version's section of `CHANGELOG.md`. It becomes the text of the release; a tag without it stops the workflow.

## Version

Set the version in `package.json` and in `src/version.ts`. `pnpm check` fails when the two differ, and the workflow stops when the tag is not `v` followed by that version.

## Checks before the tag

Run the release-level checks, one at a time:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm audit --audit-level high
npm pack --dry-run --json --ignore-scripts
```

The SSKR engine rebuild (`pnpm verify:sskr`) takes long and runs on GitHub for the tag, so it is not repeated here. Check that every commit since the last release is signed: `git cat-file -p <commit>` shows a `gpgsig` header. Push the release commit to `main` and wait for its CI.

## Signed tag

Make an annotated tag, signed like the commits with the SSH key that Git is set up with, and push it:

```sh
git tag -s v0.1.0 -m "MnemoCode 0.1.0"
git cat-file -p v0.1.0
git push origin v0.1.0
```

`git cat-file -p` must show an SSH signature at the end of the tag. This signature of the Git history is separate from the OpenPGP signature of the release files.

## The tag's workflow

The tag starts `.github/workflows/executable.yml`:

- `verify` runs the complete CI on the tagged commit.
- `sskr` rebuilds the SSKR engine in its pinned container and compares it byte for byte with the committed one.
- `build` builds the executable on Linux, Windows and macOS, runs each one from an empty folder and drives its menu in a pseudo-terminal.
- `release` runs after all three have passed. It writes `SHA256SUMS`, has GitHub attest the build provenance of every file it lists, and creates the draft release with the three executables, their license notices, `SHA256SUMS` and the release notes. It stops when the tag has a release or a draft already, because GitHub would keep a second draft with other builds beside the first; to run it again, delete the draft on GitHub first.

## Sign the draft

The signing computer needs the [GitHub CLI](https://cli.github.com/) with the `gh attestation` command, logged in (`gh auth login`) with the right to edit releases of `hobby-eng/mnemocode`; GnuPG with the release key; and `sha256sum`. The release key's fingerprint:

```text
28FC51B1DB80DF2101128CB30EDD4814591DD095
```

From the checkout:

```sh
node scripts/sign-release.mjs v0.1.0 --dry-run
node scripts/sign-release.mjs v0.1.0
```

`--dry-run` prints every command in order and runs none of them. A real run:

1. Checks that the tools and the secret key are there and that `v0.1.0` has exactly one release on GitHub, a draft.
2. Downloads the draft into `release-signing-v0.1.0/`, a new folder that Git ignores.
3. Checks that the folder holds exactly the files that `SHA256SUMS` lists, runs `sha256sum --check --strict SHA256SUMS`, and `gh attestation verify` for each file.
4. Signs with `gpg --local-user 28FC51B1DB80DF2101128CB30EDD4814591DD095 --armor --detach-sign`, which writes `SHA256SUMS.asc`. GnuPG asks for the passphrase itself; the script never reads or copies the private key.
5. Checks the signature with `gpg --verify` and that the release key made it.
6. Exports the public key as `RELEASE-SIGNING-KEY.asc`.
7. Uploads `SHA256SUMS.asc` and `RELEASE-SIGNING-KEY.asc` to the draft, replacing those of an earlier, unfinished run.

A failure stops the script with one line that says why, Ctrl+C with "Cancelled.", and nothing is uploaded before every check has passed. To run it again, move the folder away first. The key is valid until 2028-10-04; extend it before then and publish the extended public key on GitHub.

## Publish

Look at the draft on GitHub: the notes, the six files, `SHA256SUMS`, `SHA256SUMS.asc` and `RELEASE-SIGNING-KEY.asc`. Then publish it there, or with:

```sh
gh release edit v0.1.0 --repo hobby-eng/mnemocode --draft=false
```

`node scripts/sign-release.mjs v0.1.0 --publish` signs and publishes in one run.

## Verify a download

Anyone can check a release this way; the README shows the same steps.

```sh
gpg --show-keys RELEASE-SIGNING-KEY.asc
gpg --import RELEASE-SIGNING-KEY.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify mnemocode-0.1.0-linux-x64 --repo hobby-eng/mnemocode
```

`gpg --show-keys` must show the fingerprint above, and `gpg --verify` must say "Good signature". Compare the fingerprint with a source you trust, such as the key GitHub shows for the maintainer at https://github.com/hobby-eng.gpg: a key that comes with the download proves nothing by itself. `--ignore-missing` lets the check pass when only some files were downloaded. The signature shows which key signed `SHA256SUMS`; the attestation shows that a file was built from this repository by its release workflow.
