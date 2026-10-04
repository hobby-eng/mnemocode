// Whether an output path lies in a folder that a cloud service synchronises, so that a saved
// record, card or share would also be copied to that service. The folders are recognised by the
// names the services give them; this is a warning, not a guarantee in either direction.

import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Folder names, compared without case, and the service they belong to. */
const CLOUD_FOLDER_NAMES: readonly (readonly [RegExp, string])[] = [
  [/^dropbox( \(.+\))?$/iu, "Dropbox"],
  [/^onedrive( - .+)?$/iu, "OneDrive"],
  // Google Drive for desktop: "My Drive" on Windows and inside macOS's CloudStorage folder.
  [/^(google drive|my drive|googledrive-.+)$/iu, "Google Drive"],
  // macOS keeps iCloud Drive in ~/Library/Mobile Documents.
  [/^(icloud drive|mobile documents|icloud~.+|com~apple~clouddocs)$/iu, "iCloud Drive"],
  [/^yandex\.?disk$/iu, "Yandex Disk"],
  [/^(nextcloud|owncloud)$/iu, "Nextcloud"],
  [/^mega(sync)?$/iu, "MEGA"],
  [/^pcloud ?drive$/iu, "pCloud"],
];

/** Environment variables in which Windows names the OneDrive folders. */
const ONEDRIVE_VARIABLES = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] as const;

function inside(folder: string, path: string): boolean {
  const relation = relative(resolve(folder), resolve(path));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

/** The cloud service that synchronises `path`, or undefined when none is recognised. */
export function cloudServiceOf(
  path: string,
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string | undefined {
  const absolute = resolve(path);
  for (const variable of ONEDRIVE_VARIABLES) {
    const folder = environment[variable];
    if (folder !== undefined && folder !== "" && inside(folder, absolute)) return "OneDrive";
  }
  // Every folder below macOS's ~/Library/CloudStorage belongs to a service, named in its own name.
  const cloudStorage = resolve(home, "Library", "CloudStorage");
  if (inside(cloudStorage, absolute) && absolute !== cloudStorage) {
    const provider = relative(cloudStorage, absolute).split(sep)[0]!;
    const known = CLOUD_FOLDER_NAMES.find(([pattern]) => pattern.test(provider))?.[1];
    return known ?? provider.split("-")[0];
  }
  // The folders above the file or new folder; its own name says nothing.
  for (const folder of absolute.split(/[\\/]/u).slice(0, -1)) {
    const service = CLOUD_FOLDER_NAMES.find(([pattern]) => pattern.test(folder))?.[1];
    if (service !== undefined) return service;
  }
  return undefined;
}
