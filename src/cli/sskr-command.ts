// sskr-split, sskr-combine and sskr-export: a seed phrase split into Shamir shares (SSKR), and
// shares typed or read back to restore the phrase or to write the shares again. From the command
// line every input is given, and one that cannot be used ends the command. With --ask-secrets, on
// the private screen, each answer is checked as soon as it is given: a share that cannot be used
// is named and typed again, or left out, a date is asked again, and a result that cannot be used
// offers what to change; every other answer is kept (share-repair.ts, ask.ts, date-search.ts). A
// file that cannot be saved is offered again, under another name, or skipped (save-retry.ts), and
// what was made is still shown. What the shares are, and the phrases they give with the dates, the
// library decides (sskr/share-input.ts, share-set.ts, share-unmasking.ts).
//
// Each command is a module of its own; this one gathers them for the command line.

export { sskrExportOptions } from "./sskr-output.js";
export { prepareSskrSplit, runSskrSplit } from "./sskr-split-command.js";
export {
  givenShares,
  restoreFromShare,
  runSskrCombine,
  sskrInputOptions,
} from "./sskr-restore-command.js";
export { runSskrExport } from "./sskr-export-command.js";
