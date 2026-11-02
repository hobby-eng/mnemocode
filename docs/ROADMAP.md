# Roadmap

Plans, not promises. Current capabilities are distinguished from future work below.

## The pages of the wallet tools

Each release carries the WebAssembly files of the pages of the [multi-chain wallet tools](https://github.com/hobby-eng/multi-chain-wallet-tools), one set for each page and edition: the transformations, records, cards, the wallet checks of the twelve coins, and recovery of a forgotten word, of forgotten digits of the dates and of damaged Shamir shares, with the list of candidate phrases for the Discovery Scanner. The pages still take the TypeScript version's sources; moving them to these files is the next step there, and the program and the pages then run the same compiled code.

## Faster searches and larger workloads

- speed up recovery of several forgotten words, with the same wallet checks for every supported coin;
- hand very large lists of candidates to the scanner.

## Mobile applications

Android and, where feasible, iOS applications are future work using the same host-neutral Rust library for transformations and recovery; platform adapters provide input, files, randomness, execution and protection. Before implementation, assess each system's memory and process limits, long-running search behaviour, and secret cleanup when the application pauses, stops or is terminated. Establish supported workloads, devices and available memory and process protections from those checks before making compatibility claims. These applications are not part of the current command-line release.
