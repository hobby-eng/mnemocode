const labels: Readonly<Record<string, string>> = {
  all: "all templates selection",
  "ask-secrets": "hidden-input mode",
  "bip39-passphrase-file": "BIP39 passphrase file",
  "bitcoin-address": "Bitcoin address",
  "bitcoin-profile": "Bitcoin address profile",
  "card-layout": "card layout",
  "card-qr": "card QR code",
  cards: "terminal color card display",
  "cards-dir": "folder for individual card files",
  "compressed-public-key": "compressed public key",
  date: "date list",
  dates: "date list",
  event: "event label list",
  events: "event label list",
  format: "representation format",
  "image-format": "image format",
  "images-dir": "image output folder",
  index: "word index",
  input: "encoded text",
  "input-file": "encoded input file",
  "legacy-valid-last-word": "legacy checksum word replacement",
  list: "template listing",
  "master-fingerprint": "master fingerprint",
  "max-results": "result limit",
  "max-candidates": "candidate search limit",
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
