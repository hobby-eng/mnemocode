// Folders of a test's own, in the system's temporary folder, removed with what they hold when the
// test ends, also when it fails. Public test data only goes there.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/** A new empty folder whose name starts with `prefix`, removed when the current test ends. */
export async function testFolder(prefix: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

/** The path `name` in a new folder of its own (testFolder), where nothing is yet. */
export async function testPath(prefix: string, name: string): Promise<string> {
  return join(await testFolder(prefix), name);
}
