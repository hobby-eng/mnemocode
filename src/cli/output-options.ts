/**
 * Options that name a file to save, and options that name a new folder to save into. Numbered
 * names (output-paths.ts), the write permission (protection.ts) and the cloud-folder warning
 * (command-line.ts) all follow these lists, so that a new output cannot miss one of them.
 */
export const FILE_OUTPUTS = ["output", "pdf", "qr", "heir-sheet", "candidates-file"] as const;
export const FOLDER_OUTPUTS = ["cards-dir", "images-dir"] as const;
export const SAVED_OPTIONS = [...FILE_OUTPUTS, ...FOLDER_OUTPUTS] as const;
