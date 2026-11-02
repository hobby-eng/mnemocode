# Candidate lists

When a search leaves several possible seed phrases, MnemoCode can save them as a candidate list. The Discovery Scanner of the [multi-chain wallet tools](https://github.com/hobby-eng/multi-chain-wallet-tools) imports the list and checks candidates online. The Wallet Deriver's Recovery tab writes the same format.

This page specifies candidate ordering, MNCL bytes and encryption. `vectors/candidates-v1.json` contains test vectors for all three. For host APIs and cleanup contracts, use the [library guide](LIBRARY.md#candidate-list-encryption).

Candidate N on MnemoCode's screen is record N of the file, counting from 1.

## Where the candidates come from

| Search                                                                           | Command                       | Order of the candidates      |
| -------------------------------------------------------------------------------- | ----------------------------- | ---------------------------- |
| Unknown words at known places                                                    | `recover-word`                | [below](#unknown-words)      |
| One word missing at an unknown place                                             | `recover-word --missing-word` | [below](#a-missing-word)     |
| Forgotten digits of the Seedshift dates                                          | `recover-date`                | as `recover-date` lists them |
| Damaged Shamir shares, forgotten date digits of a phrase masked before splitting | `sskr-combine`                | as `sskr-combine` lists them |

The searches are host-neutral parts of MnemoCode, which are compiled into the native CLI and WebAssembly binding, so the same input gives the same list in both: `recovery::word_search::WordCandidateSearch` in `crates/mnemocode/src/recovery/word_search.rs` for words, `DateSearch` in `crates/mnemocode/src/recovery/date_search.rs` for dates, and `crates/mnemocode/src/sskr/joint.rs` for shares.

A candidate is kept only when its BIP39 checksum is valid. A wallet check (a fingerprint, an address, a public key) works differently by search: `recover-word` lists and saves every candidate and marks those that match, while `recover-date` and `sskr-combine` list and save only the candidates that match. Either way the list holds exactly the candidates the screen numbers, in that order.

### Unknown words

The phrase is written as 12, 15, 18, 21 or 24 places separated by spaces. Each place is one of:

| Written      | Means                                                             |
| ------------ | ----------------------------------------------------------------- |
| `zoo`        | that English BIP39 word                                           |
| `?`          | any of the 2,048 words                                            |
| `ab*`        | any word that starts with the letters given; at least one matches |
| `rich\|rice` | one of the words given                                            |

Letters are compared after Unicode NFKD and lower-casing. A place whose words reduce to one, such as `zoo*` or `zoo|zoo`, is a known word.

The unknown places are taken in ascending order, u₁ < u₂ < … < uₖ, and the words of each place in the order of the BIP39 English list. The candidates are the combinations in lexicographic order of (word at u₁, word at u₂, …, word at uₖ), the word at uₖ changing fastest, of which only those with a valid checksum are kept. The number of combinations, the product of the numbers of words at the unknown places, may be at most 2^24 = 16,777,216.

### A missing word

The phrase is written as 11, 14, 17, 20 or 23 known words, one fewer than a valid length, and one word of any of the 2,048 is missing at an unknown place. Place p, from 1 to n = the written count + 1, means that the missing word becomes word p of the phrase.

The candidates are taken with p ascending, and for each p with the word in the order of the BIP39 English list; only those with a valid checksum are kept. Inserting word w at place p gives the same phrase as inserting it at place p − 1 when the written word just before the gap, written word p − 1, is w itself. Such a phrase is counted once, at the first of these places: the combination is skipped when p ≥ 2 and written word p − 1 is w.

## The list

The list is a sequence of bytes. Integers are unsigned and big-endian. Text is UTF-8 and must decode without errors.

| Bytes | Field                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 4     | Magic: `4D 4E 43 4C`, the letters `MNCL`                                                                                                     |
| 1     | Version: 1                                                                                                                                   |
| 1     | Flags: bit 0 (value 1), a passphrase for all records follows; bit 1 (value 2), every record carries a passphrase field. The other bits are 0 |
| 1     | Entropy length E in bytes: 16, 20, 24, 28 or 32, for 12 to 24 words                                                                          |
| 4     | Record count N, from 1 to 524,288                                                                                                            |
| 2 + L | Only with bit 0: the passphrase for all records, its length L from 1 to 256, then its bytes                                                  |
| …     | N records, in order (below)                                                                                                                  |
| 4     | CRC-32 of every byte above, from the magic on                                                                                                |
| …     | Zero bytes, up to the padded length (below)                                                                                                  |

A record is the BIP39 entropy of the candidate, E bytes; with bit 1 of the flags it is followed by a passphrase field, a length L from 0 to 256 in 2 bytes and L bytes of text. The phrase is the BIP39 English mnemonic of the entropy.

The BIP39 passphrase of a record is its own when its field is not empty; otherwise the passphrase for all records when there is one; otherwise empty. A passphrase is stored as it was entered; BIP39 applies Unicode NFKD when the seed is computed.

CRC-32 is the one of zlib and PNG: polynomial 0x04C11DB7, reflected, initial value and final XOR 0xFFFFFFFF; the CRC-32 of the ASCII bytes `123456789` is 0xCBF43926. It finds damage to a file that is not encrypted; age authenticates an encrypted one.

### Padding

The size of an encrypted file would otherwise tell how many candidates it holds. The list is therefore padded with zero bytes to the length that Padmé gives for its length L before padding (Nikitin et al., "Reducing Metadata Leakage from Encrypted Files and Communication with PURBs", PETS 2019), which adds at most about 12 %:

```text
E    = floor(log2(L))
S    = floor(log2(E)) + 1
mask = 2^(E − S) − 1
padded length = (L + mask) with the low E − S bits cleared
```

A reader computes L from the fields, then checks that the length of the list is exactly the padded length and that every padding byte is zero. Anything else, an unknown version or flag bit, a count or length out of range, a wrong CRC-32 or a byte too many or too few, means the list is refused as a whole.

## Encryption

A list leaves MnemoCode encrypted with [age](https://age-encryption.org/v1), in its binary form, never armored, by default. Exactly one of these two kinds is allowed, and a reader checks that the header has exactly one stanza in all, of that kind:

- **To the Scanner's key.** The Scanner makes a one-time X25519 key for one session and shows its recipient, `age1…`, 62 characters, which can be typed, pasted or read from a file, a file's leading byte order mark left out; stanza type `X25519`. Upper and lower case are the same. A file with more than one recipient is refused, because it is only as strong as its weakest stanza.
- **With a passphrase.** Stanza type `scrypt`, with the work factor log2 N = 18 exactly; any other is refused. It is a separate file and the only stanza in it, as age requires. The passphrase is the text as entered without white space at its ends (Unicode's White_Space, as every value that MnemoCode reads whole is trimmed; a byte order mark is no white space), and when read from a file also without a leading byte order mark; its UTF-8 bytes, with no Unicode normalization, are what age gets. MnemoCode refuses one shorter than 12 characters.

X25519 is not post-quantum: a file kept today could be opened by a large quantum computer in the future. A passphrase file is symmetric and not exposed in this way, as long as the passphrase is strong.

With `--ask-secrets` and no key or passphrase file, MnemoCode asks for the candidate-list encryption passphrase twice before searching. Both prompts distinguish it from the BIP39 passphrase. Short or mismatching answers are explained and asked again; cancellation stops the operation.

When `recover-word` offers a list after a long result, including a pattern read with `--mnemonic-file`, it asks for the chosen passphrase in the same way before rerunning the search for that list. If saving fails, you can retry, change the filename or skip saving; the candidates remain on screen.

The [library guide](LIBRARY.md#candidate-list-encryption) describes encryption initialization, session identities and protection selection. A plaintext file is written only on explicit request (`--plaintext-candidates`), with a warning; a reader decides whether to permit plaintext import.

## Limits

- At most 524,288 records (2^19) in one list. Two forgotten words of a 12-word phrase give 262,144 candidates on average, and at most a few thousand more when neither of them is the last word, so they always fit. Without passphrases a full list is 8,650,752 bytes for 12 words and 17,301,504 for 24, after padding; with a passphrase of its own for every record it can reach 155,189,248 bytes after padding, including a maximum-length global passphrase as well.
- At most 2^24 combinations in one word search, which bounds the time of the search itself. Such a search can give more candidates than one list holds, up to about a million for 12 words; it is then refused, and more of the words are needed.
- At most 256 bytes for one passphrase.

### File admission for hosts

Use `candidates::admission` before reading a file in full or asking for a key. The [host admission contract](LIBRARY.md#file-admission-for-hosts) specifies byte ceilings, prefix ownership, bounded reads, cleanup and refusal codes. Format byte limits do not bound process memory: decoded records and strings require more space.
