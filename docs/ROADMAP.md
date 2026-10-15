# Roadmap

Plans, not promises. Current capabilities are distinguished from future work below.

## Recovery in the Wallet Deriver

The Wallet Deriver of the [multi-chain wallet tools](https://github.com/hobby-eng/multi-chain-wallet-tools) compiles MnemoCode's own sources ([how](https://github.com/hobby-eng/multi-chain-wallet-tools/blob/main/docs/MNEMOCODE_SOURCE.md)). MnemoCode's host-neutral library already provides transformations, records, cards and recovery:

- a forgotten word of a seed phrase;
- forgotten digits of the dates;
- damaged Shamir shares, each on its own or all together, with the assessment shown before a search;
- the list of candidate phrases for the discovery scanner.

The code that does this is written for any host, not only for Node.js. It imports no Node.js module; what differs between hosts, HMAC-SHA256 and the SSKR library, comes from a small interface that the host fills in, as the Deriver already does for the images and QR codes of the cards. A test keeps these modules that way ([Architecture](ARCHITECTURE.md#modules-for-other-hosts)).

## MnemoCode in Rust

The Rust port is planned for the release after 0.1.0. It includes G1-001: give Bytewords/UR share transport one owner in Rust, instead of first consolidating the current TypeScript and Rust implementations in a separate change.

MnemoCode is to be rewritten in Rust, as mhfe is: one library crate with the command-line program, and a WASM build that the Deriver loads. The program and the Deriver would then run the same compiled code instead of the same TypeScript sources. The existing TypeScript library already checks the twelve supported coins and recovers several forgotten words against a fingerprint or address. Future work concerns the Rust implementation, faster searches and larger workloads:

- preserve wallet checks for every supported coin;
- speed up recovery of several forgotten words, with the same wallet checks;
- handing very large lists of candidates to the scanner.
