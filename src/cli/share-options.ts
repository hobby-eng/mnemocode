/**
 * The options that give shares, each of which may be repeated, and which --ask-secrets asks for on
 * the private screen instead. A module of its own, because the parser (arguments.ts) and the
 * share commands (sskr-restore-command.ts) both read it, and the commands import the parser.
 */
export const SHARE_SOURCE_OPTIONS = Object.freeze(["share", "share-file", "share-qr"] as const);
