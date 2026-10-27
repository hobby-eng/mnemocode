# MnemoCode in Rust

This is the Rust version of [MnemoCode](https://github.com/hobby-eng/mnemocode), being built. It is
not ready to use: until it is, use the released MnemoCode 0.1.0.

When it is finished, it will do everything MnemoCode 0.1.0 does, with the same results, as one
`mnemocode` program for Linux, macOS and Windows and as the WebAssembly file each page of the
multi-chain wallet tools embeds. Each secret is kept in a type that wipes it when its work ends;
memory outside the program, such as a browser's copies of what a page shows, cannot be guaranteed
to be erased. Where the system allows it, the process writes no core dump, cannot be read by other
programs and cannot reach the network; each protection the system refuses is reported.

How it is built, and in which order: [docs/design/](docs/design/README.md).

## Licence

MnemoCode is offered under the MIT licence ([LICENSE-MIT](LICENSE-MIT)) or the Apache License 2.0
([LICENSE-APACHE](LICENSE-APACHE)), at your option. The third-party material it includes is listed
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
