// The verdict of the check of written shares (ShareBackupCheck.check, core/backup-check.ts), as
// the command line runs it after a split: the tests ask it through the class the program uses.

import { type BackupVerdict, ShareBackupCheck } from "../../src/core/backup-check.js";
import type { SplitMode } from "../../src/core/masking.js";
import { nodeSharePlatform } from "../../src/sskr/share-platform-node.js";

/** What a host calls the entry that reads an encoded seed phrase, which a refusal may name. */
const TEXTS = { decodeEntry: "The Decode tab" };

/**
 * Whether the shares `typed`, separated by semicolons, with the dates of `dateLine`, restore
 * `original`. The shares are not counted against a threshold here: the restore asks for the
 * quorum that they record.
 */
export async function shareBackupVerdict(
  original: string,
  typed: string,
  mode: SplitMode,
  dateLine: string,
): Promise<BackupVerdict> {
  using check = new ShareBackupCheck(
    { mnemonic: original, mode, threshold: 1 },
    nodeSharePlatform,
    TEXTS,
  );
  return (await check.check({ backup: typed, dates: dateLine })).verdict;
}
