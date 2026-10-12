// Whether a path is a folder or lies inside it, compared by the path alone, as written and
// resolved (no link is followed): the checks of outputs against each other, the outputs the menu
// has claimed, and the warning of a cloud folder share this one rule.

import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Whether `child` is `parent` or lies inside it; a folder named "..notes" lies inside. The path is
 * split at the separator of this system only: on Linux and macOS a backslash is a character of a
 * name, as in a folder named "..\\notes" (AUD-012-API003).
 */
export function pathWithin(parent: string, child: string): boolean {
  const relation = relative(resolve(parent), resolve(child));
  return relation === "" || (relation.split(sep)[0] !== ".." && !isAbsolute(relation));
}

/** Whether two paths are the same, or one lies inside the other (pathWithin). */
export function pathsOverlap(left: string, right: string): boolean {
  return pathWithin(left, right) || pathWithin(right, left);
}
