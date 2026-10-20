// A promise that a test settles itself, to hold a step of the program at an await until the test
// has looked at what the step left, and then let it go on.

/** A promise that stays pending until `release` is called. */
export interface Deferred {
  readonly promise: Promise<void>;
  /** Fulfils `promise`; a later call does nothing. */
  readonly release: () => void;
}

/** A new pending Deferred. */
export function deferred(): Deferred {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
