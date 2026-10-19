import { afterEach, expect, it, vi } from "vitest";
import { Decrypter, Encrypter } from "age-encryption";
import {
  checkCandidateEncryptionQuick,
  createSessionIdentity,
  decryptCandidates,
  encryptCandidates,
  PassphraseProtection,
} from "../src/core/candidate-encryption.js";

const FAILED = "core.candidate-encryption.self-test-failed";

function deferred(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function holdSymmetricChecks(failures: readonly boolean[]) {
  const gates = failures.map((fails) => ({ entered: deferred(), held: deferred(), fails }));
  const native: unknown = Reflect.get(Decrypter.prototype, "addIdentity");
  if (typeof native !== "function") throw new Error("The test needs the native age adapter.");
  let next = 0;
  vi.spyOn(Decrypter.prototype, "addIdentity").mockImplementation(function (
    this: Decrypter,
    identity,
  ) {
    if (typeof identity === "string" || !("unwrapFileKey" in identity)) {
      Reflect.apply(native, this, [identity]);
      return;
    }
    const gate = gates[next++];
    if (gate === undefined) {
      Reflect.apply(native, this, [identity]);
      return;
    }
    const delayed: Parameters<Decrypter["addIdentity"]>[0] = {
      async unwrapFileKey(stanzas) {
        gate.entered.release();
        await gate.held.promise;
        if (gate.fails) throw new Error("Synthetic held self-test failure.");
        return identity.unwrapFileKey(stanzas);
      },
    };
    Reflect.apply(native, this, [delayed]);
  });
  return gates;
}

function holdByteEncryption(bytes: Uint8Array) {
  const entered = deferred();
  const held = deferred();
  function delayed(file: Uint8Array): Promise<Uint8Array>;
  function delayed(file: ReadableStream<Uint8Array>): ReturnType<Encrypter["encrypt"]>;
  async function delayed(
    file: Uint8Array | ReadableStream<Uint8Array>,
  ): Promise<Uint8Array | Awaited<ReturnType<Encrypter["encrypt"]>>> {
    if (!(file instanceof Uint8Array)) throw new Error("The test adapter expects byte input.");
    entered.release();
    await held.promise;
    return bytes;
  }
  vi.spyOn(Encrypter.prototype, "encrypt").mockImplementationOnce(delayed);
  return { entered, held };
}

afterEach(() => vi.restoreAllMocks());

it("invalidates warm success after an explicit self-test failure before encrypting caller material", async () => {
  const pair = await createSessionIdentity();
  const plain = Uint8Array.of(1, 2, 3);
  const writes = vi.spyOn(Encrypter.prototype, "encrypt");
  vi.spyOn(Decrypter.prototype, "addIdentity").mockImplementation(() => {
    throw new Error("Synthetic explicit self-test failure.");
  });
  try {
    const checking = expect(checkCandidateEncryptionQuick()).rejects.toThrow(
      "Synthetic explicit self-test failure.",
    );
    await expect(encryptCandidates(plain, pair.recipient)).rejects.toHaveProperty("code", FAILED);
    await checking;
    expect(writes.mock.calls.some(([input]) => Object.is(input, plain))).toBe(false);
    expect([...plain]).toEqual([1, 2, 3]);
  } finally {
    plain.fill(0);
  }
});

it("holds new caller encryption behind a forced self-test even when first-use checks were cached", async () => {
  const pair = await createSessionIdentity();
  const plain = Uint8Array.of(4, 5, 6);
  const [gate] = holdSymmetricChecks([false]);
  const writes = vi.spyOn(Encrypter.prototype, "encrypt");
  const checking = checkCandidateEncryptionQuick();
  await gate!.entered.promise;
  const encrypted = encryptCandidates(plain, pair.recipient);
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes.mock.calls.some(([input]) => Object.is(input, plain))).toBe(false);
  } finally {
    gate!.held.release();
    await checking;
    const bytes = await encrypted;
    bytes.fill(0);
    plain.fill(0);
  }
  expect(writes.mock.calls.some(([input]) => Object.is(input, plain))).toBe(true);
});

it.each([false, true])(
  "retires late ciphertext after a failed concurrent self-test (transient: %s)",
  async (transient) => {
    const pair = await createSessionIdentity();
    const plain = Uint8Array.of(7, 8, 9);
    const writer = new Encrypter();
    writer.addRecipient(pair.recipient);
    const bytes = await writer.encrypt(plain);
    const { entered, held } = holdByteEncryption(bytes);
    const encrypted = encryptCandidates(plain, pair.recipient);
    await entered.promise;
    const reads = vi.spyOn(Decrypter.prototype, "addIdentity");
    const fault = (): never => {
      throw new Error("Synthetic concurrent self-test failure.");
    };
    if (transient) reads.mockImplementationOnce(fault);
    else reads.mockImplementation(fault);
    try {
      await expect(checkCandidateEncryptionQuick()).rejects.toThrow(
        "Synthetic concurrent self-test failure.",
      );
      const refused = expect(encrypted).rejects.toHaveProperty("code", FAILED);
      held.release();
      await refused;
      expect(bytes.every((byte) => byte === 0)).toBe(true);
      expect([...plain]).toEqual([7, 8, 9]);
      if (transient) {
        const fresh = await encryptCandidates(plain, pair.recipient);
        expect(fresh.some((byte) => byte !== 0)).toBe(true);
        fresh.fill(0);
      }
    } finally {
      held.release();
      bytes.fill(0);
      plain.fill(0);
    }
  },
);

it.each(["older-first", "newer-first"] as const)(
  "does not let a superseded failed check poison newer work (%s)",
  async (order) => {
    const pair = await createSessionIdentity();
    const plain = Uint8Array.of(10, 11, 12);
    const bytes = Uint8Array.of(90, 91, 92);
    const [older, newer] = holdSymmetricChecks([true, false]);
    const rejected = expect(checkCandidateEncryptionQuick()).rejects.toThrow(
      "Synthetic held self-test failure.",
    );
    await older!.entered.promise;
    const current = checkCandidateEncryptionQuick();
    await newer!.entered.promise;
    let operation: Promise<Uint8Array> | undefined;
    let encrypted: ReturnType<typeof holdByteEncryption> | undefined;
    try {
      if (order === "older-first") {
        older!.held.release();
        await rejected;
      }
      newer!.held.release();
      await current;
      encrypted = holdByteEncryption(bytes);
      operation = encryptCandidates(plain, pair.recipient);
      await encrypted.entered.promise;
      older!.held.release();
      await rejected;
      encrypted.held.release();
      expect(await operation).toBe(bytes);
      expect([...bytes]).toEqual([90, 91, 92]);
    } finally {
      older!.held.release();
      newer!.held.release();
      encrypted?.held.release();
      if (operation !== undefined) await operation;
      bytes.fill(0);
      plain.fill(0);
    }
  },
);

it("retires delayed decrypted plaintext after a transient failed explicit self-test", async () => {
  const pair = await createSessionIdentity();
  const plain = Uint8Array.of(21, 22, 23);
  const file = await encryptCandidates(plain, pair.recipient);
  const entered = deferred();
  const held = deferred();
  const retired: Uint8Array[] = [];
  const fill: unknown = Reflect.get(Uint8Array.prototype, "fill");
  if (typeof fill !== "function") throw new Error("The test needs the native byte fill.");
  vi.spyOn(Uint8Array.prototype, "fill").mockImplementation(function (this: Uint8Array, ...args) {
    if (this.length === plain.length && this.every((byte, index) => byte === plain[index]))
      retired.push(this);
    Reflect.apply(fill, this, args);
    return this;
  });
  vi.spyOn(Decrypter.prototype, "decrypt").mockImplementationOnce(async () =>
    Object.assign(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from(plain));
          entered.release();
          void held.promise.then(() => controller.close());
        },
      }),
      { size: () => plain.length },
    ),
  );
  const decrypted = decryptCandidates(file, { identity: pair.identity });
  await entered.promise;
  vi.spyOn(Decrypter.prototype, "addIdentity").mockImplementationOnce(() => {
    throw new Error("Synthetic plaintext self-test failure.");
  });
  try {
    await expect(checkCandidateEncryptionQuick()).rejects.toThrow(
      "Synthetic plaintext self-test failure.",
    );
    const refused = expect(decrypted).rejects.toHaveProperty("code", FAILED);
    held.release();
    await refused;
    expect(new Set(retired).size).toBe(2);
    expect(retired.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    expect([...plain]).toEqual([21, 22, 23]);
  } finally {
    held.release();
    plain.fill(0);
    file.fill(0);
  }
});

it.each([
  { failed: true, disposed: false },
  { failed: true, disposed: true },
  { failed: false, disposed: true },
])(
  "retires a late passphrase-protection result ($failed failure, $disposed disposal)",
  async ({ failed, disposed }) => {
    await createSessionIdentity();
    const plain = Uint8Array.of(31, 32, 33);
    const bytes = Uint8Array.of(93, 94, 95);
    // The lifetime-only cipher adapter avoids running the unchanged full-size KDF in this test.
    const { entered, held } = holdByteEncryption(bytes);
    using protection = new PassphraseProtection("public synthetic test passphrase");
    const encrypted = protection.protect(plain);
    await entered.promise;
    try {
      if (failed) {
        vi.spyOn(Decrypter.prototype, "addIdentity").mockImplementationOnce(() => {
          throw new Error("Synthetic protection self-test failure.");
        });
        await expect(checkCandidateEncryptionQuick()).rejects.toThrow(
          "Synthetic protection self-test failure.",
        );
      }
      if (disposed) protection.wipe();
      const refused = expect(encrypted).rejects.toHaveProperty(
        "code",
        failed ? FAILED : "core.secret-value.wiped",
      );
      held.release();
      await refused;
      expect([...bytes]).toEqual([0, 0, 0]);
      expect([...plain]).toEqual([31, 32, 33]);
    } finally {
      held.release();
      plain.fill(0);
      bytes.fill(0);
    }
  },
);
