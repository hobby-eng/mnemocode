// Bounded public-fixture/synthetic-file baseline probe; no PDF rendering.
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { publishNewFolder, absentPath } from "../../../src/export/private-file.ts";

const evidence = resolve("docs/audits/AUD-012-evidence");
const directory = await fs.mkdtemp(join(evidence, "skeptic-export-probe-"));
const originalChmod = fs.chmod;
const marker = "PUBLIC SYNTHETIC MARKER ONLY\n";
const exists = async (path) => {
  try {
    await fs.lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};
const rejection = async (action) => {
  try {
    return { rejected: false, result: await action() };
  } catch (error) {
    return { rejected: true, code: error.code ?? null, message: error.message };
  }
};
let result;
try {
  const successfulTarget = join(directory, "successful");
  const success = await publishNewFolder(
    successfulTarget,
    ".success-",
    "taken",
    async (staging) => {
      await fs.writeFile(join(staging, "marker"), marker, { mode: 0o600, flag: "wx" });
      return 1;
    },
  );
  const successfulControl = {
    result: success,
    markerMatches: (await fs.readFile(join(successfulTarget, "marker"), "utf8")) === marker,
    folderMode: (await fs.stat(successfulTarget)).mode & 0o777,
  };

  let writerStaging;
  const writerTarget = join(directory, "writer-failed");
  const writerFailure = await rejection(() =>
    publishNewFolder(writerTarget, ".writer-", "taken", async (staging) => {
      writerStaging = staging;
      await fs.writeFile(join(staging, "marker"), marker, { mode: 0o600, flag: "wx" });
      throw Object.assign(new Error("Injected synthetic writer failure"), { code: "EIO" });
    }),
  );
  const writerFailureControl = {
    ...writerFailure,
    targetExists: await exists(writerTarget),
    stagingExists: await exists(writerStaging),
  };

  const failedTarget = join(directory, "chmod-failed");
  let injectedCalls = 0;
  fs.chmod = async (path, mode) => {
    if (path === failedTarget) {
      injectedCalls++;
      throw Object.assign(new Error("Injected synthetic post-rename chmod failure"), {
        code: "EIO",
      });
    }
    return originalChmod(path, mode);
  };
  syncBuiltinESMExports();
  if ((await import("node:fs/promises")).chmod !== fs.chmod)
    throw new Error("Injection did not update production named import");
  let failedStaging;
  const failure = await rejection(() =>
    publishNewFolder(failedTarget, ".chmod-", "taken", async (staging) => {
      failedStaging = staging;
      await fs.writeFile(join(staging, "marker"), marker, { mode: 0o600, flag: "wx" });
      return 1;
    }),
  );
  result = {
    mechanism:
      "actual publishNewFolder; process-local fs.chmod injection synced to named builtin imports; real mkdtemp/writeFile/rename/rm",
    successfulControl,
    writerFailureControl,
    postRenameChmodFailure: {
      ...failure,
      injectedCalls,
      targetExists: await exists(failedTarget),
      markerMatches: (await fs.readFile(join(failedTarget, "marker"), "utf8")) === marker,
      stagingExists: await exists(failedStaging),
      folderMode: (await fs.stat(failedTarget)).mode & 0o777,
      markerMode: (await fs.stat(join(failedTarget, "marker"))).mode & 0o777,
      subsequentAbsentPath: await rejection(() => absentPath(failedTarget, "taken")),
    },
    runtime: { node: process.version, platform: process.platform },
    limitation:
      "Injected EIO proves error-path semantics; no naturally failing filesystem or PDF/image pipeline was exercised",
  };
} finally {
  fs.chmod = originalChmod;
  syncBuiltinESMExports();
  await fs.rm(directory, { recursive: true, force: true });
}
result.syntheticProbeDirectoryRemoved = !(await exists(directory));
console.log(JSON.stringify(result, null, 2));
