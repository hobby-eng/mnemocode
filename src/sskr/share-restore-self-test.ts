// The self-test of the restore of shares as sskr-combine, decode's share input and sskr-export run
// it (sskr/share-restore.ts): the published set's first two shares, one of them with a colour
// unread, read as typed, repaired together and restored to the published phrase; the same shares
// with a wallet that is not theirs, told as such; and one share alone, too few
// (AUD-037-FUN005). It answers later, so core/self-test.ts runs it only in the full self-test.
//
// From the host it needs its SharePlatform (sskr/share-platform.ts). It holds public test data, no
// secret.
//
// Host-neutral: it imports only core modules and other host-neutral sskr modules.

import { expectSame } from "../core/self-test-check.js";
import { sskrSetVector } from "./known-answers.js";
import { ShareInput } from "./share-input.js";
import type { SharePlatform } from "./share-platform.js";
import { ShareRestore } from "./share-restore.js";
import { writeShare } from "./transport.js";

/** What a host calls the entry that reads an encoded seed phrase, which a refusal may name. */
const TEXTS = { decodeEntry: "Decode" };

/** The input of `shares` as typed. */
function typed(shares: readonly string[]): ShareInput {
  const input = new ShareInput(TEXTS);
  input.add(shares);
  return input;
}

/** The second share of the published set as colours, its sixth colour unread. */
function markedSecond(): string {
  const colors = writeShare(sskrSetVector.shares[1], "colors").split(" ");
  colors[5] = "?";
  return colors.join(" ");
}

/** A restore of marked shares, one with a wallet not theirs, and one of too few shares. */
export async function checkShareRestore(platform: SharePlatform): Promise<void> {
  const restore = new ShareRestore(platform);
  const shares = [sskrSetVector.shares[0], markedSecond()];
  {
    using input = typed(shares);
    const restored = await restore.restore({ input, mode: "direct", confirmed: true });
    expectSame(restored.kind, "phrases", "Shares restored: outcome");
    if (restored.kind === "phrases")
      expectSame(
        restored.phrases.map((phrase) => phrase.mnemonic).join("|"),
        sskrSetVector.phrase,
        "Shares restored: phrase",
      );
  }
  {
    using input = typed(shares);
    const other = await restore.restore({
      input,
      mode: "direct",
      confirmed: true,
      walletCheck: () => ({ matched: false }),
    });
    expectSame(other.kind, "trouble", "Shares of another wallet");
  }
  using one = typed([sskrSetVector.shares[0]]);
  expectSame(
    (await restore.restore({ input: one, mode: "direct", confirmed: true })).kind,
    "few",
    "One share of two",
  );
}
