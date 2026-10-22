/**
 * Options that name a file to save, and options that name a new folder to save into. Numbered
 * names (output-paths.ts), the write permission (protection.ts) and the cloud-folder warning
 * (command-line.ts) all follow these lists, so that a new output cannot miss one of them.
 */
export const FILE_OUTPUTS = ["output", "pdf", "qr", "heir-sheet", "candidates-file"] as const;
export const FOLDER_OUTPUTS = ["cards-dir", "images-dir", "word-lists-dir", "qr-dir"] as const;
export const SAVED_OPTIONS = [...FILE_OUTPUTS, ...FOLDER_OUTPUTS] as const;

/** Text-file inputs that also accept "-" for the command's single standard-input source. */
export const STDIN_INPUT_OPTIONS = [
  "mnemonic-file",
  "input-file",
  "share-file",
  "dates-file",
  "old-dates-file",
  "last-word-file",
] as const;

/**
 * File inputs cannot overlap an output or be numbered as its replacement (output-paths.ts).
 * A test keeps every file/folder option in exactly one input/output list.
 */
export const FILE_INPUTS = [
  ...STDIN_INPUT_OPTIONS,
  "share-qr",
  "candidates-key-file",
  "candidates-passphrase-file",
  "bip39-passphrase-file",
  "wif-file",
  "qr-file",
] as const;

/**
 * Options that draw images, with pdftocairo: the commands that save cards take them, and they
 * allow the program to be run (protection.ts).
 */
export const DRAWING_OPTIONS = ["images-dir", "image-format"] as const;
