// Colours and layout of everything MnemoCode shows in a terminal. They follow the one style of the
// bip_tools command-line tools (the same as `mhfe`): the sixteen standard colours only, cyan for
// headings and options, grey for labels and secondary text, a green ✓, a yellow ! and a red ✗.
// Output that does not go to a terminal carries no colour codes and keeps its plain form.

/** SGR codes of the shared palette. Bright black is the grey of most schemes; "dim" is too faint in some. */
export const STYLE = {
  heading: '1;36',
  accent: '36',
  strong: '1',
  muted: '90',
  good: '1;32',
  warning: '1;33',
  bad: '1;31',
} as const;

/** Longest line of running text, so that messages read well in an 80-column terminal. */
const TEXT_WIDTH = 78;
const RESET = '\x1b[0m';

/**
 * Whether `channel` gets colour, decided as the Rust tools decide it: NO_COLOR turns it off,
 * CLICOLOR_FORCE turns it on, and otherwise only a terminal that is not "dumb" and has not set
 * CLICOLOR=0 gets it.
 */
export function terminalColor(channel: 'stdout' | 'stderr'): boolean {
  const environment = process.env;
  if (environment.NO_COLOR !== undefined && environment.NO_COLOR !== '') return false;
  if (
    environment.CLICOLOR_FORCE !== undefined &&
    environment.CLICOLOR_FORCE !== '' &&
    environment.CLICOLOR_FORCE !== '0'
  )
    return true;
  if (process[channel].isTTY !== true) return false;
  if (environment.TERM === 'dumb') return false;
  return environment.CLICOLOR !== '0';
}

export function terminalPaint(channel: 'stdout' | 'stderr', code: string, text: string): string {
  return terminalColor(channel) ? `\x1b[${code}m${text}${RESET}` : text;
}

/** Breaks `text` into lines of at most `width` characters at spaces. */
export function wrapText(text: string, width: number = TEXT_WIDTH): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter((part) => part !== '')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = '';
    }
    line = line === '' ? word : `${line} ${word}`;
  }
  if (line !== '') lines.push(line);
  return lines;
}

/**
 * The heading of a result, "MnemoCode · <title>", and its facts as grey labels with their values,
 * like the summary of `mhfe`. Returns false without printing when stdout has no colour; the caller
 * then prints its plain form.
 */
export function terminalResultHeader(title: string, rows: readonly [string, string][]): boolean {
  if (!terminalColor('stdout')) return false;
  const paint = (code: string, text: string): string => terminalPaint('stdout', code, text);
  console.log(
    `\n${paint(STYLE.heading, 'MnemoCode')} ${paint(STYLE.muted, '·')} ${paint(STYLE.strong, title)}`,
  );
  const labelWidth = Math.max(10, ...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    console.log(`  ${paint(STYLE.muted, label.padEnd(labelWidth))} ${value}`);
  }
  return true;
}

/** A checked fact after a green ✓ (or a yellow ! when `good` is false): its label and its value in bold. */
export function terminalStatus(label: string, value: string, good: boolean = true): void {
  const mark = good
    ? terminalPaint('stderr', STYLE.good, '✓')
    : terminalPaint('stderr', STYLE.warning, '!');
  console.error(`${mark} ${label} ${terminalPaint('stderr', STYLE.strong, value)}`);
}

/** Advice that can be read and passed over: grey, wrapped to the text width. */
export function terminalHint(message: string): void {
  if (!terminalColor('stderr')) {
    console.error(message);
    return;
  }
  for (const line of wrapText(message)) console.error(terminalPaint('stderr', STYLE.muted, line));
}

/** Human-facing status goes to stderr; redirected output contains no ANSI escapes. */
export function terminalNotice(
  message: string,
  kind: 'info' | 'success' | 'warning' = 'info',
): void {
  if (!terminalColor('stderr')) {
    console.error(message);
    return;
  }
  if (kind === 'info') {
    terminalHint(message);
    return;
  }
  const [mark, code] = kind === 'success' ? ['✓', STYLE.good] : ['!', STYLE.warning];
  const lines = wrapText(message, TEXT_WIDTH - 2);
  lines.forEach((line, index) => {
    const text = kind === 'warning' ? terminalPaint('stderr', code, line) : line;
    console.error(`${index === 0 ? terminalPaint('stderr', code, mark) : ' '} ${text}`);
  });
}

/** An error message after a red "✗ Error:", as `mhfe` writes it. */
export function terminalFailure(message: string): void {
  if (!terminalColor('stderr')) {
    console.error(`mnemocode: ${message}`);
    return;
  }
  console.error(`${terminalPaint('stderr', STYLE.bad, '✗ Error:')} ${message}`);
}

export function colorCards(colors: readonly string[]): string {
  if (!terminalColor('stderr')) return colors.join(' ');
  return colors
    .map((color) => {
      const red = Number.parseInt(color.slice(1, 3), 16);
      const green = Number.parseInt(color.slice(3, 5), 16);
      const blue = Number.parseInt(color.slice(5, 7), 16);
      const light = (red * 299 + green * 587 + blue * 114) / 1000 > 150;
      // The colour itself is the content here, so it is shown in true colour, not the palette.
      return `\x1b[48;2;${red};${green};${blue}m\x1b[${light ? '30' : '97'}m ${color} ${RESET}`;
    })
    .join(' ');
}
