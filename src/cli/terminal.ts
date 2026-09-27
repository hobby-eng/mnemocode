export function terminalColor(channel: 'stdout' | 'stderr'): boolean {
  return process.env.NO_COLOR === undefined && process[channel].isTTY === true;
}

export function terminalPaint(channel: 'stdout' | 'stderr', code: string, text: string): string {
  return terminalColor(channel) ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function terminalResultHeader(kind: string, rows: readonly [string, string][]): boolean {
  if (!terminalColor('stdout')) return false;
  console.log(`\n${terminalPaint('stdout', '1;36', `╭─ ${kind}`)}`);
  for (const [label, result] of rows) {
    console.log(
      `${terminalPaint('stdout', '2;36', '│')} ${terminalPaint('stdout', '2', `${label}:`)} ${terminalPaint('stdout', '1', result)}`,
    );
  }
  console.log(
    terminalPaint(
      'stdout',
      '2;36',
      '╰────────────────────────────────────────────────────────────────────',
    ),
  );
  return true;
}

export function terminalStatus(
  symbol: string,
  label: string,
  result: string,
  color: string = '32',
): void {
  console.error(
    `${terminalPaint('stderr', `1;${color}`, symbol)} ${terminalPaint('stderr', '1', label)} ${terminalPaint('stderr', '36', result)}`,
  );
}

export function colorCards(colors: readonly string[]): string {
  if (!terminalColor('stderr')) return colors.join(' ');
  return colors
    .map((color) => {
      const red = Number.parseInt(color.slice(1, 3), 16);
      const green = Number.parseInt(color.slice(3, 5), 16);
      const blue = Number.parseInt(color.slice(5, 7), 16);
      const light = (red * 299 + green * 587 + blue * 114) / 1000 > 150;
      return `\x1b[48;2;${red};${green};${blue}m\x1b[${light ? '30' : '97'}m ${color} \x1b[0m`;
    })
    .join(' ');
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
  const symbol = kind === 'success' ? '✓' : kind === 'warning' ? '!' : '•';
  const color = kind === 'success' ? '32' : kind === 'warning' ? '33' : '36';
  console.error(
    `${terminalPaint('stderr', '1;' + color, symbol)} ${terminalPaint('stderr', kind === 'info' ? '2' : '1', message)}`,
  );
}

export function terminalFailure(message: string): void {
  if (!terminalColor('stderr')) {
    console.error(`mnemocode: ${message}`);
    return;
  }
  console.error(`\n${terminalPaint('stderr', '1;31', '╭─ ERROR')}`);
  console.error(`${terminalPaint('stderr', '31', '│')} ${message}`);
  console.error(
    terminalPaint(
      'stderr',
      '2;31',
      '╰────────────────────────────────────────────────────────────────────',
    ),
  );
}
