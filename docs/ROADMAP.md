# Roadmap

Plans, not promises. Nothing here is built yet unless it says so.

## Recovery in the Wallet Deriver

The Wallet Deriver of the [multi-chain wallet tools](https://github.com/hobby-eng/multi-chain-wallet-tools) already compiles MnemoCode's own sources for its MnemoCode feature: the transformations, the record format and the cards ([how](https://github.com/hobby-eng/multi-chain-wallet-tools/blob/main/docs/MNEMOCODE_SOURCE.md)). The recovery functions are meant to follow, as a tab of their own:

- a forgotten word of a seed phrase;
- forgotten digits of the dates;
- damaged Shamir shares, each on its own or all together, with the assessment shown before a search;
- the list of candidate phrases for the discovery scanner.

The code that does this is written for any host, not only for Node.js. It imports no Node.js module; what differs between hosts, HMAC-SHA256 and the SSKR library, comes from a small interface that the host fills in, as the Deriver already does for the images and QR codes of the cards. A test keeps these modules that way ([Architecture](ARCHITECTURE.md#modules-for-other-hosts)).

## MnemoCode in Rust

MnemoCode is to be rewritten in Rust, as mhfe is: one library crate with the command-line program, and a WASM build that the Deriver loads. The program and the Deriver would then run the same compiled code instead of the same TypeScript sources. Waiting for it:

- wallet checks for the coins of mhfe's address list, not only Bitcoin;
- recovery of more than one forgotten word, checked against a fingerprint or an address, which native code makes several times faster;
- handing very large lists of candidates to the scanner.
