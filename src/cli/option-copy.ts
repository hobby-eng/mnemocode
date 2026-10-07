import { coinById, type WalletEvidence } from "../bitcoin-evidence.js";

const labels: Readonly<Record<string, string>> = {
  all: "all templates selection",
  "ask-secrets": "secret prompt mode",
  "backup-check": "written-backup check",
  "bip39-passphrase-file": "BIP39 passphrase file",
  "bitcoin-address": "Bitcoin address",
  "bitcoin-profile": "Bitcoin address profile",
  coin: "coin",
  "coin-address": "coin address",
  "card-layout": "card layout",
  "card-qr": "card QR code",
  "candidates-file": "candidates file",
  "candidates-key": "Scanner key",
  "candidates-key-file": "Scanner key file",
  "candidates-passphrase-file": "candidates passphrase file",
  "missing-word": "missing word search",
  "plaintext-candidates": "unencrypted candidates",
  cards: "terminal color card display",
  "cards-dir": "folder for individual card files",
  "compressed-public-key": "compressed public key",
  "encoded-fingerprint": "encoded fingerprint",
  date: "date list",
  dates: "date list",
  event: "event label list",
  events: "event label list",
  format: "representation format",
  "heir-sheet": "instructions for heirs file",
  "heir-sheet-size": "size of the instructions for heirs",
  "image-format": "image format",
  "images-dir": "image output folder",
  index: "word index",
  input: "encoded text",
  "input-kind": "kind of the typed text",
  "input-file": "encoded input file",
  "legacy-valid-last-word": "legacy checksum word replacement",
  list: "template listing",
  "list-candidates": "listing of every candidate",
  "master-fingerprint": "master fingerprint",
  "max-results": "result limit",
  "max-candidates": "candidate search limit",
  "max-tries": "share repair search limit",
  mnemonic: "mnemonic text",
  "mnemonic-file": "mnemonic file",
  mode: "transformation mode",
  network: "Bitcoin network",
  orientation: "page orientation",
  output: "output record file",
  "page-size": "page size",
  pdf: "PDF output file",
  "progress-every": "progress interval",
  qr: "QR output file",
  "qr-file": "QR input file",
  "scan-gap": "number of addresses scanned",
  share: "share text",
  "share-file": "share file",
  "share-format": "share format",
  "share-qr": "share QR file",
  shares: "share count",
  sskr: "SSKR mode",
  template: "card template",
  threshold: "share threshold",
  title: "card title",
  unicode: "Unicode value",
  wif: "WIF",
  "wif-file": "WIF file",
  word: "BIP39 word",
  words: "mnemonic word count",
};

/** Human-facing CLI copy must not expose internal parser keys. */
export function optionLabel(key: string): string {
  return labels[key] ?? key.replaceAll("-", " ");
}

export function optionSubject(key: string): string {
  return `The ${optionLabel(key)} setting`;
}

export function optionValue(key: string): string {
  return `The ${optionLabel(key)} value`;
}

/**
 * What a wallet check compares, in the words of a result line: "master fingerprint", or for an
 * address of another coin, "address of Litecoin", whose name may be several words, such as
 * "Ethereum and EVM networks".
 */
export function evidenceLabel(evidence: WalletEvidence): string {
  return evidence.kind === "coin-address"
    ? `address of ${coinById(evidence.coin).name}`
    : optionLabel(evidence.kind);
}
