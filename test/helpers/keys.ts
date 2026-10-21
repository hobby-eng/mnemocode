// The keys that the tests type, as a terminal in raw mode sends them, each written once. The
// arrows and Home and End are xterm's CSI sequences (ctlseqs, "PC-Style Function Keys");
// Backspace is DEL, as terminals send it. It imports nothing, so that every test and helper can
// take it.

/** Escape alone, which also starts every sequence below. */
export const ESCAPE = "\x1b";
export const UP = `${ESCAPE}[A`;
export const DOWN = `${ESCAPE}[B`;
export const RIGHT = `${ESCAPE}[C`;
export const LEFT = `${ESCAPE}[D`;
export const HOME = `${ESCAPE}[H`;
export const END = `${ESCAPE}[F`;
export const CTRL_A = "\x01";
export const CTRL_C = "\x03";
export const CTRL_D = "\x04";
export const CTRL_U = "\x15";
export const CTRL_Z = "\x1a";
export const BACKSPACE = "\x7f";
/** Enter, a carriage return in raw mode. */
export const ENTER = "\r";
