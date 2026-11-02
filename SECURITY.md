# Security policy

## Reporting a vulnerability

Report a suspected vulnerability privately through the [GitHub private vulnerability reporting form](https://github.com/hobby-eng/mnemocode/security/advisories/new) of this repository. The report goes to the repository owner and maintainers. Do not describe an unfixed security problem in a public issue, discussion, pull request, screenshot or log.

Never include a real phrase, BIP39 passphrase, private key, WIF, Shamir share, date, encoded record, QR code, card or wallet export. Show the problem with a published test phrase or invented data. Include:

- the affected release or the full commit SHA;
- the operating system;
- the exact steps, without secrets;
- what you expected, what happened, and why it is a security problem.

Ordinary defects and feature requests belong in the [public issue forms](https://github.com/hobby-eng/mnemocode/issues/new/choose). If publishing a report could help an attacker or reveal recovery material, report it privately.

Security fixes are made in the current source and the current release. Installed copies and exported records do not update themselves. Check the version that you run, replace affected installations, and keep what you need to decode your existing records.

## Security model

MnemoCode is an offline command-line program and Rust library. Its own code uses no network: it has no online service, telemetry, analytics, update check or remote file. The recovery checks are calculated on your computer; MnemoCode never asks a wallet, a node or a block explorer.

MnemoCode is **not a complete sandbox**, and what limits it depends on how it runs:

- **The `mnemocode` command** asks the operating system to enforce what it offers a program: on Linux new sockets and file writes are refused by the kernel where a command does not need them; on macOS the network. A system that offers less runs with less, and `mnemocode self-test` says what was not available.
- **The library**, built into another program, runs with the file, process and network rights of that program, and adds no limit of its own.

"Offline" describes what the program does. Only the limits that the system enforces, which differ from one system and version to another, stop a compromised program from opening a connection; descriptors opened before them, such as the terminal, stay usable.

For a real phrase:

- Use a trusted computer that is disconnected from every network, preferably a freshly started read-only live system.
- Turn off Wi-Fi and Bluetooth before you enter secrets. Do not use cloud terminals or remote shells.
- Shut the temporary system down after you have saved the result.
- For more protection, use a firewall that you have checked yourself, or a virtual machine or container with networking turned off.

When the library or its WebAssembly file is built into another application, that application is responsible for security. MnemoCode does not create an iframe, Worker, Content Security Policy, process sandbox or permission boundary. A `connect-src 'none'` policy can block ordinary network requests of a browser, but other code of the same application can still read the values. Review the final application and its protections, not only this source package.

## Secret lifecycle and local boundaries

- Use [`--ask-secrets`](README.md#secret-input-styles) or the [menu](README.md#menu) for a real phrase, encoded record and dates, on Linux, macOS and Windows. The secrets are typed on a private screen that shows them and the result, and is cleared when you press Enter, so that neither what you typed nor the result stays in the scrollback: only a summary stays on the main screen, of what was saved and where and of the warnings that still hold. Anyone who can see your screen meanwhile can read them. It cannot protect against a compromised terminal, operating system or program, or against a terminal program that logs what it shows.
- MnemoCode does not collect, send or log your phrase. Each secret lives in a type that wipes it when its work ends, also when a step fails, and every block of memory that the program frees is wiped first. A working copy inside one step, such as a single date on the stack during a search, may stay until that memory is used again, and the dates of a command stay in a list that is wiped when freed. What a terminal or a browser keeps of a secret is out of its reach.
- On Linux and macOS MnemoCode switches off core dumps, so that a crash cannot write its memory, the phrase included, to the disk; on Linux this also keeps other programs of the same user from reading that memory. Without it, MnemoCode asks for no secret. Where the system allows it, a command has no network. On Linux with Landlock, one that saves nothing cannot write files, and one that saves writes only beneath the folders of its outputs, which are checked and made before any secret is read; macOS and Windows leave file writes open. Re-encode with `--ask-secrets` and no option of the new backup, as the menu runs it, asks for the new backup before the old one, and the limit on writes starts with those answers. `recover-word` on a terminal keeps the right to write until the end of its run, since the candidate list that it offers is named after its search. The start menu holds no secret and starts each command as a process of its own. Its word lookup is no private question: a word typed there stands on the main screen and in the arguments of `table`, as it does on a command line, so take the words of a real phrase from a saved word list.
- On Linux MnemoCode warns before a secret when swap is not encrypted, or when it cannot tell: the system may write the memory of MnemoCode to the disk, where it can stay for years. MnemoCode asks for the memory of each secret to be kept out of swap and says so where the system refuses; drawn pages of cards are too large for that limit, and are only wiped, and the codes on cards, the dates of a command and the working copies of a step are not locked either. Use encrypted swap or none, best a live USB system. Swap counts as safe on dm-crypt, also below LVM, and on zram.
- MnemoCode warns when a file is saved into a folder that Dropbox, OneDrive, Google Drive, iCloud Drive, Yandex Disk, Nextcloud, MEGA or pCloud synchronises: the service keeps a copy. It recognises these folders by their usual names.
- MnemoCode cannot keep the system from hibernating to the disk, and it cannot control screenshots, clipboard history, accessibility tools, browser extensions and malware.
- Text records, QR codes, PDFs, images, Shamir shares, dates and printed cards can help someone recover the phrase. Treat each of them as a secret, even when it is not the whole phrase.
- On Linux and macOS exported files and folders can be read only by your user account, on file systems that keep Unix permissions. On Windows they take the permissions of the folder they are saved in, and FAT and exFAT media keep none. A file appears under its name only when it is complete; on file systems without hard links, such as FAT and exFAT, an empty file holds the name while the complete one is moved in, and is removed if that fails. A folder name is reserved without replacing an existing directory, then its completed children are moved in. This last step is not atomic: forced termination or power loss can leave an empty or partly filled destination. These precautions do not isolate exports from malicious processes of the same account. Ctrl+C removes the temporary folders of an export; when MnemoCode is killed otherwise or the power fails, a hidden folder can remain next to the output: `.mnemocode-export-…`, `.mnemocode-images-…`, `.mnemocode-share-qr-…`, `.card-collection-…` or `.sskr-cards-…`. Each of them can hold a complete private copy; delete it. You are responsible for the permissions of the folder, backups, snapshots, cloud synchronization, removable media and later changes of permissions.
- PNG and JPEG images are drawn by MnemoCode itself; no other program sees a card, and neither a PDF nor an image goes to the system's temporary folder: each goes straight into the staging folder beside the output.
- The Shamir share library is compiled in from `vendor/`, whose files are the upstream release that each crate's `UPSTREAM.json` records, with the changes it lists. What protects the executable is its line in the release's `SHA256SUMS`, which you compare once after downloading. The random numbers for shares come from the system's cryptographically secure source, in a page from `crypto.getRandomValues`.

## Cryptographic and recovery limits

- Writing a phrase in another form or as a QR code is not encryption.
- Date masking can be reversed by anyone who knows or guesses the dates, and memorable dates are easy to guess. It does not replace proper encryption (memory-hard and authenticated) or a strong BIP39 passphrase.
- A valid BIP39 checksum does not prove that a recovered phrase is your wallet. Compare it with a detail of the wallet that you know, using the same network, address type, account, branch, index and passphrase.
- A matching address proves recovery only for the selected place in the wallet. MnemoCode does not search wallet accounts, read balances or send transactions. Check recovered addresses in maintained wallet software before you use funds.
- Any N shares of an N-of-M Shamir set restore the phrase. Keep the shares in different places.

## Residual risks and assurance

A compromised operating system, dependency, terminal, build computer, package source, firmware or physical environment can defeat these protections. Locked dependency versions and fixed hashes make builds repeatable, but they do not create trust by themselves. When you can, check the origin and the checksums of a release on another computer than the one where you enter secrets.

The project has automated tests and dated audit records. It has not had an independent security audit by cryptography specialists. The Rust library behind the Shamir shares describes itself as being under community review; the external audit of the C version does not cover it. The [design](docs/design/README.md) and the [audit records](https://github.com/hobby-eng/mnemocode/tree/main/docs/audits) describe the limits of the program; they are not a security certificate.
