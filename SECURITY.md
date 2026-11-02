# Security policy

This page explains what MnemoCode protects, what it cannot protect, and how to report a vulnerability. For backup and recovery steps, use the [README](README.md) or [command-line reference](docs/CLI.md).

## Reporting a vulnerability

Report a suspected vulnerability through this repository's [private vulnerability reporting form](https://github.com/hobby-eng/mnemocode/security/advisories/new). It reaches the owner and maintainers. Keep an unfixed security problem out of public issues, discussions, pull requests, screenshots and logs.

Use a published test phrase or invented data. Never include a real phrase, BIP39 passphrase, private key, WIF, Shamir share, date, encoded record, QR code, card or wallet export. Include:

- the affected release or full commit SHA;
- the operating system and, for a source build, Rust version;
- exact steps using only test data;
- the expected result, actual result and security impact.

Ordinary bugs and feature requests belong in the [public issue forms](https://github.com/hobby-eng/mnemocode/issues/new/choose). If a report could reveal recovery material or help an attacker, send it privately.

Security fixes are made in the current source and release. Installed copies do not update themselves. Check which version you run, replace affected installations, and retain what you need to read existing backups.

## Security model

MnemoCode is an offline command-line program and Rust library. Its own code has no online service, telemetry, analytics, update check or remote file access. Wallet comparisons are calculated locally, without contacting a wallet, node or block explorer.

Use a trusted computer disconnected from every network, preferably a freshly started read-only live system. Unplug the network cable and turn off wireless connections before entering secrets. Avoid cloud terminals and remote shells. Shut down the temporary system after saving the result. A firewall, virtual machine or container adds protection only to the extent that you trust and check its configuration.

### Command-line protections

Each menu task runs in a fresh process of the same executable. Before reading a secret, the CLI applies the protections available on that system and reads them back. It reports unavailable protections rather than assuming they worked; `self-test` lists the limits.

| Platform | Protections                                                                                                                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux    | Core dumps disabled; same-user memory inspection restricted; an attached tracer refuses secrets; seccomp blocks new sockets and io_uring; Landlock restricts file writes to the output folders where supported; a data-memory cap is requested |
| macOS    | Core dumps disabled; debugger attachment refused; Seatbelt restricts network access where available                                                                                                                                            |
| Windows  | DLL search restrictions and mitigation policies; a job object with a memory cap; Windows Error Reporting asked to omit heap data; configured LocalDumps reported                                                                               |

On Linux and macOS, failure to disable core dumps prevents secret input. Other unavailable measures are reported. Windows has no unprivileged network or file-write sandbox here. macOS leaves file writes open. The program does not restrict child-process creation; image rendering runs in process and needs no converter.

On Linux with Landlock, output folders are checked and made before secrets are read. A failed save can choose another name only within the permitted folders. Re-encode asks for the replacement's destinations before the old backup. `recover-word` can retain file writes so it can offer a candidate list after the search, when its destination is not known at startup. Missing parent folders can remain after cancellation.

Descriptors opened before restrictions, including the terminal, remain usable. “Offline” describes the program's behaviour; restrictions against a compromised process depend on the operating system and version. [Platform design](docs/design/platform/protections.md) records the decisions and system calls.

### Library and browser hosts

The library inherits its host's file, process and network permissions. It creates no iframe, Worker, Content Security Policy or sandbox of its own. A browser's `connect-src 'none'` policy can block ordinary network requests, but other code in the same application can still read values. Review the final application and its protections as well as MnemoCode.

The command-line executable and WebAssembly binding register a zeroing allocator. A native library host must register it itself to wipe general freed allocations; the library does not replace its host's allocator. Secret owner types still wipe their own buffers on drop. [The library guide](docs/LIBRARY.md#secret-ownership) describes the host's obligations.

## Secret lifecycle and local boundaries

### Input, screens and memory

Use [`--ask-secrets`](README.md#secret-input-styles) or the [menu](README.md#menu) for real recovery material. The private screen shows input and results for checking, then clears them when you leave it. The main screen keeps only a summary of saved paths and warnings. Anyone watching the private screen can read the secrets; a logging or compromised terminal can retain them.

MnemoCode does not collect, transmit or log your phrase. Secret owner types wipe their buffers on drop, including ordinary error and cancellation paths. The executable's allocator wipes freed blocks. Small secret buffers reserve their final capacity and request page locks before being filled: `mlock` on Linux and macOS, `VirtualLock` on Windows. Locks are counted per page and are best effort; a refused lock warns once. Rendered pages can exceed the lock budget and are wiped without being locked. Card codes, a command's date list and temporary stack copies are not all locked. A step's working copy may remain until that memory is reused; forced process termination does not run Rust destructors.

WebAssembly has no page-locking API. Rust owners and freed allocations can be wiped, and secret binding calls scrub their working stack. A host must still release objects it retains. JavaScript strings, DOM values and copies made by the browser cannot be guaranteed erased. Screenshots, clipboard history, accessibility tools, extensions and malware remain outside MnemoCode's control.

### Swap, hibernation and synchronized folders

On Linux, MnemoCode warns if swap is unencrypted or cannot be assessed. It recognizes dm-crypt, including beneath LVM, and zram without a backing device as safe swap configurations. Unlocked secret bytes may reach disk. Use encrypted swap or none. Hibernation can also write memory to disk; MnemoCode cannot prevent it.

MnemoCode warns for usual Dropbox, OneDrive, Google Drive, iCloud Drive, Yandex Disk, Nextcloud, MEGA and pCloud folder names. This is not complete synchronization detection. Use a local destination whose permissions, backups and synchronization you control.

### Exported files

Records, QR codes, PDFs, images, shares, dates and printed cards can help recover a wallet. Treat each as secret recovery material even if it is insufficient on its own.

On Linux and macOS files and folders are created for your account only, where the filesystem supports Unix permissions. Windows uses the destination folder's permissions; FAT and exFAT cannot provide those Unix permissions. Completed files are published without replacing existing names. On filesystems without hard links, an empty file reserves the name while the completed file is moved in; a failed move removes that reservation.

Folder publication reserves a new directory, then moves completed children into it. This is not atomic: forced termination or power loss can leave an empty or partial destination. These precautions do not isolate exports from malicious processes running as the same user.

Ctrl+C cleans up temporary export folders. Other termination or power loss can leave a hidden folder beside the output:

- `.mnemocode-export-…`
- `.mnemocode-images-…`
- `.mnemocode-share-qr-…`
- `.card-collection-…`
- `.sskr-cards-…`

These folders may contain a complete private copy; remove any abandoned ones. You remain responsible for destination permissions, snapshots, backups, cloud copies and removable media.

### Image rendering

PDFs, PNGs and JPEGs are drawn by MnemoCode itself. No external image converter receives a card. Export files are staged beside the destination, rather than in the system temporary folder. Generated QR matrices and PNGs are decoded and compared with their expected content before use; this does not certify a later printed or photographed copy.

### Share-engine integrity

The SSKR engine is compiled into the executable from the sources recorded in `vendor/*/UPSTREAM.json`, with the local crypto shim in `shims/bc-crypto`. There is no separate engine file or runtime hash check to install. Verify the executable against the signed release `SHA256SUMS` before running it. Pinned sources and checksums establish identity, not freedom from defects. Share randomness comes from the operating system, or `crypto.getRandomValues` through the WebAssembly adapter.

## Cryptographic and recovery limits

- Another representation or QR code is not encryption.
- Date masking can be reversed by anyone who knows or guesses the dates. Memorable dates are easy to guess; they do not replace authenticated, memory-hard encryption or a strong BIP39 passphrase.
- A valid BIP39 checksum does not identify your wallet. Compare recovered material with a known wallet reference, using the original network, address type, account, branch, index and passphrase.
- An address match checks the selected wallet location. MnemoCode does not discover accounts, read balances or send transactions. Verify recovered addresses in maintained wallet software before using funds.
- Any N distinct shares of an N-of-M set restore the phrase. Store shares separately. A BIP39 passphrase is not included in them.

## Residual risks and assurance

A compromised operating system, dependency, terminal, build computer, package source, firmware or physical environment can defeat these protections. Pinned versions and hashes help reproduce builds; they do not establish trust by themselves. Where possible, verify a release's origin and checksums on another computer before entering secrets.

The project has automated tests and dated audit records. It has not had an independent security audit by cryptography specialists. The Rust SSKR library describes itself as under community review; the external audit of the C implementation does not cover it. The [architecture](docs/ARCHITECTURE.md) and [audit records](docs/audits/README.md) describe the evidence and its limits.
