// A command line as a person would type it in the shell of the system: each argument quoted only
// where a shell would read it, so that the line the menu shows runs as it is.
// scripts/sign-release.mjs shows the commands it runs with the same rule.
//
// A leaf: it imports nothing and uses only TypeScript that Node can strip, because
// sign-release.mjs loads it from the sources without a build.

/**
 * Characters that sh, bash, zsh, cmd.exe and PowerShell all take as they are, so that an argument
 * of only these is shown without quotes. % (cmd.exe variables) and , (PowerShell arrays) are not
 * among them.
 */
const PLAIN_ARGUMENT = /^[\w./:@+=-]+$/u;

/** A first character that a shell still reads: zsh expands =name to the path of a program, and
 * PowerShell reads @name as splatting. */
const SPECIAL_FIRST = /^[=@]/u;

/**
 * An argument that PowerShell may read as a number and pass on as it writes that number: 4E00 as
 * 4, 0x10 as 16, 1kb as 1024, 007 as 7, also after a sign or a point. Only a plain decimal
 * without a leading zero is passed on as it was typed.
 */
const NUMBER_START = /^[+-]?\.?\d/u;
const PLAIN_DECIMAL = /^(?:0|[1-9]\d*)$/u;

/**
 * What cmd.exe or PowerShell still reads inside double quotes: " and its typographic forms
 * U+201C, U+201D and U+201E, which PowerShell takes as quotes too, $ and ` (PowerShell), % ! and ^
 * (cmd.exe), a line break, and a backslash at the end, which the program's own reading of its
 * command line takes as an escape of the closing quote.
 */
const SPECIAL_IN_DOUBLE_QUOTES = /["\u201C\u201D\u201E$`%!^\r\n]|\\$/u;

/** The characters that end a PowerShell single-quoted string: ' and its typographic forms U+2018,
 * U+2019, U+201A and U+201B. */
const POWERSHELL_SINGLE_QUOTES = /['\u2018\u2019\u201A\u201B]/gu;

/** Whether `argument` reads the same in every shell of `platform` without quotes. */
function isPlain(argument: string, platform: NodeJS.Platform): boolean {
  if (!PLAIN_ARGUMENT.test(argument) || SPECIAL_FIRST.test(argument)) return false;
  return platform !== "win32" || !NUMBER_START.test(argument) || PLAIN_DECIMAL.test(argument);
}

/** An argument in single quotes, where a POSIX shell expands nothing; a ' inside ends them. */
function posixQuoted(argument: string): string {
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

/**
 * An argument quoted for both shells of Windows. cmd.exe knows only double quotes, and they read
 * the same in PowerShell while the argument holds none of SPECIAL_IN_DOUBLE_QUOTES, which leaves
 * paths with spaces and backslashes in them. Anything else gets PowerShell's single quotes, inside
 * which each of its five single quote characters is doubled; cmd.exe has no quotes for it.
 */
function windowsQuoted(argument: string): string {
  if (!SPECIAL_IN_DOUBLE_QUOTES.test(argument)) return `"${argument}"`;
  return `'${argument.replace(POWERSHELL_SINGLE_QUOTES, "$&$&")}'`;
}

/**
 * `argv`, the program and its arguments, as it would be typed in the shell of the system: an
 * argument with anything a shell reads, such as a space, $, ` or \, and on Windows one that
 * PowerShell may read as a number, is quoted so that no shell changes it (AUD-008-UI002).
 */
export function typedLine(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  const quote = platform === "win32" ? windowsQuoted : posixQuoted;
  return argv
    .map((argument) => (isPlain(argument, platform) ? argument : quote(argument)))
    .join(" ");
}

/** A command line of MnemoCode with the arguments `run`, as it would be typed (typedLine). */
export function typedCommand(
  run: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  return typedLine(["mnemocode", ...run], platform);
}

/** Indent of the typed command under "The same as:". */
const COMMAND_INDENT = "  ";

/** Prose wrapping changes quoted arguments; let the terminal soft-wrap the literal command. */
export function commandDisplay(run: readonly string[]): string {
  return `${COMMAND_INDENT}${typedCommand(run)}`;
}
