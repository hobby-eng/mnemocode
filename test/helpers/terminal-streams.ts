// Standard output and standard error as a person's terminal, for the test that asks for them: the
// layout of results follows whether a stream is a terminal (terminalLayout), and colour follows the
// colour settings alone (AUD-037-UI006), so that a test of the terminal layout makes both streams
// terminals rather than only forcing colour.

import { onTestFinished } from "vitest";

/** Makes both streams terminals until the end of the current test. */
export function streamsAsTerminal(): void {
  const saved = (["stdout", "stderr"] as const).map(
    (name) => [name, Object.getOwnPropertyDescriptor(process[name], "isTTY")] as const,
  );
  for (const [name] of saved)
    Object.defineProperty(process[name], "isTTY", { value: true, configurable: true });
  onTestFinished(() => {
    for (const [name, descriptor] of saved)
      if (descriptor === undefined) Reflect.deleteProperty(process[name], "isTTY");
      else Object.defineProperty(process[name], "isTTY", descriptor);
  });
}
