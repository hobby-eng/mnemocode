# Security policy

## Reporting a vulnerability

Report a suspected vulnerability privately through the [GitHub private vulnerability reporting form](https://github.com/hobby-eng/mnemocode/security/advisories/new) of this repository. The report goes to the repository owner and maintainers. Do not describe an unfixed security problem in a public issue, discussion, pull request, screenshot or log.

Never include a real phrase, BIP39 passphrase, private key, WIF, Shamir share, date, encoded record, QR code, card or wallet export. Show the problem with a published test phrase or invented data. Include:

- the affected release or the full commit SHA;
- the operating system and the Node.js version;
- the exact steps, without secrets;
- what you expected, what happened, and why it is a security problem.

Ordinary defects and feature requests belong in the [public issue forms](https://github.com/hobby-eng/mnemocode/issues/new/choose). If publishing a report could help an attacker or reveal recovery material, report it privately.

Security fixes are made in the current source and the current release. Installed copies and exported records do not update themselves. Check the version that you run, replace affected installations, and keep what you need to decode your existing records.

## Security model

MnemoCode is an offline Node.js command-line program and TypeScript library. Its own code uses no network: it has no online service, telemetry, analytics, update check or remote file. The recovery checks are calculated on your computer; MnemoCode never asks a wallet, a node or a block explorer.

MnemoCode is **not a sandbox**, and what limits it depends on how it runs:

- **The `mnemocode` command and the single executable** run under the Node.js permission model, described [below](#secret-lifecycle-and-local-boundaries): no network, no worker threads and no native addons. A Node.js process that already runs under the permission model and was given such a right on purpose, such as `--allow-net`, keeps it; MnemoCode does not take back rights that its caller granted.
- **The library**, built into another program, runs with the file, process and network rights of that program, and adds no limit of its own.

Neither is a limit of the operating system. "Offline" describes what the program does; it does not mean that the system stops a compromised program from opening a connection.

For a real phrase:

- Use a trusted computer that is disconnected from every network, preferably a freshly started read-only live system.
- Turn off Wi-Fi and Bluetooth before you enter secrets. Do not use cloud terminals or remote shells.
- Shut the temporary system down after you have saved the result.
- For more protection, use a firewall that you have checked yourself, or a virtual machine or container with networking turned off.

When the library is built into another application, that application is responsible for security. MnemoCode does not create an iframe, Worker, Content Security Policy, process sandbox or permission boundary. A `connect-src 'none'` policy can block ordinary network requests of a browser, but other code of the same application can still read the values. Review the final application and its protections, not only this source package.

## Secret lifecycle and local boundaries

- Use [`--ask-secrets`](README.md#secret-input-styles) or the [menu](README.md#menu) for a real phrase, encoded record and dates, on Linux, macOS and Windows. The secrets are typed on a private screen that shows them and the result, and is cleared when you press Enter, so that nothing stays in the scrollback. Anyone who can see your screen meanwhile can read them. It cannot protect against a compromised terminal, operating system or program, or against a terminal program that logs what it shows.
- MnemoCode does not collect, send or log your phrase. It clears its temporary copies of the phrase data, but text in JavaScript memory cannot be erased.
- Every run is protected as far as Node.js allows. On Linux and macOS MnemoCode switches off core dumps, so that a crash cannot write its memory, the phrase included, to the disk; on Linux this also keeps other programs of the same user from reading that memory. Without it, MnemoCode asks for no secret. Started as a command, it runs under the Node.js permission model: no network, no worker threads and no native addons, unless a caller already under that model granted one on purpose; a command that saves nothing cannot write files, and one that draws no images cannot start other programs. Each entry of the menu runs in a process of its own. Node.js enforces these limits, not the kernel, and describes them as a safety belt for trusted code rather than a boundary against malicious code.
- On Linux MnemoCode warns before a secret when swap is not encrypted, or when it cannot tell: the system may write the memory of MnemoCode to the disk, where it can stay for years. Use encrypted swap or none, best a live USB system. Swap counts as safe on dm-crypt, also below LVM, and on zram.
- MnemoCode warns when a file is saved into a folder that Dropbox, OneDrive, Google Drive, iCloud Drive, Yandex Disk, Nextcloud, MEGA or pCloud synchronises: the service keeps a copy. It recognises these folders by their usual names.
- MnemoCode cannot keep the system from hibernating to the disk, and it cannot control screenshots, clipboard history, accessibility tools, browser extensions and malware.
- Text records, QR codes, PDFs, images, Shamir shares, dates and printed cards can help someone recover the phrase. Treat each of them as a secret, even when it is not the whole phrase.
- Exported files can be read only by your user account, where the system supports this. A file appears under its name only when it is complete; on file systems without hard links, such as FAT and exFAT, an empty file holds the name while the complete one is moved in, and is removed if that fails. If MnemoCode is stopped by force or the computer loses power during an export, a hidden folder can remain next to the file or folder: `.mnemocode-export-…`, `.mnemocode-images-…`, `.card-collection-…` or `.sskr-cards-…`. Image export can also leave a `mnemocode-raster-…` folder in `/dev/shm` on Linux, which lives in memory until the computer is switched off, and in the system's temporary folder elsewhere. Each of them can hold a complete private copy; delete it. You are responsible for the permissions of the folder, backups, snapshots, cloud synchronization, removable media and later changes of permissions.
- PNG and JPEG export runs the local program `pdftocairo` on a private temporary PDF. Use a trusted local installation of Poppler.
- Run from source or from an installed package, MnemoCode compares the files of the Shamir share library on the local disk with fixed SHA-256 hashes before any secret is processed. The hashes show that the files have not changed. They do not prove that the library has no defects. In the single executable the library and its hashes are built into the one file, so this check only shows that the file is consistent; what protects the executable is its line in the release's `SHA256SUMS`, which you compare once after downloading. The random numbers for shares come from Node.js `crypto.randomBytes`.

## Cryptographic and recovery limits

- Writing a phrase in another form or as a QR code is not encryption.
- Date masking can be reversed by anyone who knows or guesses the dates, and memorable dates are easy to guess. It does not replace proper encryption (memory-hard and authenticated) or a strong BIP39 passphrase.
- A valid BIP39 checksum does not prove that a recovered phrase is your wallet. Compare it with a detail of the wallet that you know, using the same network, address type, account, branch, index and passphrase.
- A matching address proves recovery only for the selected place in the wallet. MnemoCode does not search wallet accounts, read balances or send transactions. Check recovered addresses in maintained wallet software before you use funds.
- Any N shares of an N-of-M Shamir set restore the phrase. Keep the shares in different places.

## Residual risks and assurance

A compromised operating system, Node.js, dependency, image program, terminal, build computer, package source, firmware or physical environment can defeat these protections. Locked dependency versions and fixed hashes make builds repeatable, but they do not create trust by themselves. When you can, check the origin and the checksums of a release on another computer than the one where you enter secrets.

The project has automated tests and dated audit records. It has not had an independent security audit by cryptography specialists. The Rust library behind the Shamir shares describes itself as being under community review; the external audit of the C version does not cover it. The [source layout](docs/ARCHITECTURE.md) and the [audit records](https://github.com/hobby-eng/mnemocode/tree/main/docs/audits) describe the limits of the program; they are not a security certificate.
