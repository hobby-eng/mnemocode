import { Decrypter, Encrypter } from "age-encryption";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidateFileAdmission } from "../src/core/candidate-file-admission.js";
import {
  CandidateFileRefusedError,
  decryptCandidates,
  encryptCandidates,
  encryptCandidatesWithPassphrase,
  listFileLock,
  NoProtection,
} from "../src/core/candidate-encryption.js";
import {
  decodeCandidateList,
  MAX_CANDIDATE_LIST_BYTES,
  OpenedCandidateList,
} from "../src/core/candidate-list.js";
import { checkCandidateListStartup } from "../src/core/candidate-list-self-test.js";
import { checkCandidateEncryptionQuick } from "../src/core/candidate-encryption-self-test.js";
import { candidateVectors } from "./helpers/vectors.js";
import { containing } from "./helpers/matchers.js";

// Public fixtures independently opened with Python (vectors/candidates-v1.json).
const vectors = candidateVectors();
const bytesOf = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const ageFiles = vectors.age.open as { name: string; file: string }[];
const keyFile = () => bytesOf(ageFiles.find((file) => !file.name.includes("passphrase"))!.file);
const parameters = CandidateFileAdmission.parameters();

afterEach(() => vi.restoreAllMocks());

/** Model a large announced chunk without allocating a large secret-bearing test buffer. */
function announcedBytes(bytes: Uint8Array, length: number): Uint8Array {
  Object.defineProperty(bytes, "byteLength", { value: length });
  return bytes;
}

describe("Candidate file admission", () => {
  it("fails the startup check if the plaintext ceiling refusal is lost", () => {
    vi.spyOn(OpenedCandidateList, "assertSize").mockImplementation(() => undefined);
    expect(() => checkCandidateListStartup()).toThrow("An oversized candidate list was accepted");
  });

  it("fails the quick startup check if the encrypted ceiling refusal is lost", async () => {
    vi.spyOn(CandidateFileAdmission, "assertSize").mockImplementation(() => undefined);
    await expect(checkCandidateEncryptionQuick()).rejects.toThrow(
      "An oversized encrypted candidate file was accepted",
    );
  });

  it("derives exact ceilings from MNCL v1, Padme and age STREAM", () => {
    // Computed independently with Python integer arithmetic from docs/CANDIDATES.md.
    expect(parameters).toEqual({
      headerBytes: 65_536,
      plaintextBytes: 155_189_248,
      encryptedBytes: 155_292_688,
    });
    expect(parameters.plaintextBytes).toBe(MAX_CANDIDATE_LIST_BYTES);
    expect(Object.isFrozen(parameters)).toBe(true);
    for (const [form, maximum] of [
      ["plaintext", parameters.plaintextBytes],
      ["age", parameters.encryptedBytes],
    ] as const) {
      expect(() => CandidateFileAdmission.assertSize(maximum, form)).not.toThrow();
      expect(() => CandidateFileAdmission.assertSize(maximum + 1, form)).toThrow(
        CandidateFileRefusedError,
      );
    }
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "refuses an invalid announced size %s before reading",
    async (size) => {
      const read = vi.fn();
      await expect(CandidateFileAdmission.inspect(size, read)).rejects.toMatchObject({
        code: "unsupported",
      });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("refuses an oversized encrypted file before a prefix read", async () => {
    const read = vi.fn();
    await expect(
      CandidateFileAdmission.inspect(parameters.encryptedBytes + 1, read),
    ).rejects.toThrow(`limit of ${parameters.encryptedBytes} bytes`);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(ageFiles)(
    "admits the small $name header without deriving a key",
    async ({ name, file }) => {
      const bytes = bytesOf(file);
      const prefix = bytes.slice();
      const read = vi.fn(async () => prefix);
      const decrypt = vi.spyOn(Decrypter.prototype, "decrypt");
      const lock = name.includes("passphrase") ? "passphrase" : "key";
      expect(await CandidateFileAdmission.inspect(bytes.byteLength, read)).toBe(lock);
      expect(read).toHaveBeenCalledExactlyOnceWith(bytes.byteLength);
      expect(prefix.every((byte) => byte === 0)).toBe(true);
      expect(listFileLock(bytes)).toBe(lock);
      expect(decrypt).not.toHaveBeenCalled();
    },
  );

  it("caps the prefix read even for the largest supported encrypted file", async () => {
    const prefix = new Uint8Array(parameters.headerBytes);
    prefix.set(keyFile());
    const read = vi.fn(async () => prefix);
    expect(await CandidateFileAdmission.inspect(parameters.encryptedBytes, read)).toBe("key");
    expect(read).toHaveBeenCalledExactlyOnceWith(parameters.headerBytes);
    expect(prefix.every((byte) => byte === 0)).toBe(true);
  });
});

describe("Candidate file admission", () => {
  it.each([-1, 1])("refuses and wipes a prefix with a changed length (%s)", async (difference) => {
    const file = keyFile();
    const prefix = new Uint8Array(file.byteLength + difference).fill(1);
    await expect(
      CandidateFileAdmission.inspect(file.byteLength, async () => prefix),
    ).rejects.toMatchObject({ code: "damaged" });
    expect(prefix.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects an incomplete MAC line at the prefix boundary", () => {
    const file = keyFile();
    // Remove the final header newline, not a byte of the binary payload.
    const text = new TextDecoder("latin1").decode(file);
    const macStart = text.indexOf("\n--- ") + 1;
    const macEnd = file.indexOf(10, macStart);
    expect(() => CandidateFileAdmission.lock(file.subarray(0, macEnd))).toThrow(
      "The age header has no end.",
    );
  });

  it("rejects an unterminated header without reading beyond the prefix", async () => {
    const prefix = new Uint8Array(parameters.headerBytes).fill(65);
    prefix.set(new TextEncoder().encode("age-encryption.org/v1\n-> X25519 "));
    const read = vi.fn(async () => prefix);
    await expect(CandidateFileAdmission.inspect(parameters.headerBytes + 1, read)).rejects.toThrow(
      "The age header has no end.",
    );
    expect(read).toHaveBeenCalledExactlyOnceWith(parameters.headerBytes);
    expect(prefix.every((byte) => byte === 0)).toBe(true);
  });

  it.each(vectors.age.refuse as { name: string; file: string }[])(
    "refuses the unsupported $name header without a key operation",
    async ({ file }) => {
      const bytes = bytesOf(file);
      await expect(
        CandidateFileAdmission.inspect(bytes.byteLength, async () => bytes.slice()),
      ).rejects.toMatchObject({ code: "unsupported" });
    },
  );

  it.each(["stanza", "body", "MAC"])("refuses malformed %s before decryption", (part) => {
    const header = new TextDecoder("latin1").decode(keyFile()).split("\n").slice(0, 4);
    if (part === "stanza") header[1] += " extra";
    else if (part === "body") header[2] = "!";
    else header[3] = "--- !";
    expect(() =>
      CandidateFileAdmission.lock(new TextEncoder().encode(header.join("\n") + "\n")),
    ).toThrow("The age header is malformed.");
  });

  it("opens the independent X25519 fixture unchanged", async () => {
    expect(await decryptCandidates(keyFile(), { identity: vectors.age.identity })).toEqual(
      bytesOf(vectors.age.plaintext),
    );
  });

  it.each([65_535, 65_536, 65_537])(
    "authenticates X25519 payloads across the STREAM boundary (%s bytes)",
    async (length) => {
      const plain = new Uint8Array(length).fill(73);
      const encrypted = await encryptCandidates(plain, vectors.age.recipient);
      expect(await decryptCandidates(encrypted, { identity: vectors.age.identity })).toEqual(plain);
      encrypted[encrypted.length - 1]! ^= 1;
      await expect(
        decryptCandidates(encrypted, { identity: vectors.age.identity }),
      ).rejects.toMatchObject({
        code: "damaged",
      });
    },
  );
});

describe("Candidate file admission", () => {
  it("checks oversized encryption inputs before either key or scrypt work", async () => {
    const bytes = announcedBytes(Uint8Array.of(1), parameters.plaintextBytes + 1);
    const encrypt = vi.spyOn(Encrypter.prototype, "encrypt");
    await expect(encryptCandidates(bytes, "invalid key")).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(
      encryptCandidatesWithPassphrase(bytes, "public test passphrase"),
    ).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(() => new NoProtection().protect(bytes)).toThrow(CandidateFileRefusedError);
    expect(encrypt).not.toHaveBeenCalled();
  });

  it("checks oversized buffered files before asking age to decrypt", async () => {
    const bytes = announcedBytes(keyFile(), parameters.encryptedBytes + 1);
    const decrypt = vi.spyOn(Decrypter.prototype, "decrypt");
    await expect(
      decryptCandidates(bytes, { identity: vectors.age.identity }),
    ).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("feeds age bounded ciphertext views instead of the whole buffered file", async () => {
    const bytes = new Uint8Array(65_536 + 9);
    bytes.set(keyFile());
    const chunks: Uint8Array[] = [];
    vi.spyOn(Decrypter.prototype, "decrypt").mockImplementation(async (input) => {
      const reader = input.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return Object.assign(
        new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
        { size: (size: number) => size },
      );
    });
    expect(await decryptCandidates(bytes, { identity: vectors.age.identity })).toEqual(
      new Uint8Array(),
    );
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([65_536, 9]);
    expect(chunks.every((chunk) => chunk.buffer === bytes.buffer)).toBe(true);
    expect(chunks[0]).toEqual(bytes.subarray(0, 65_536));
    expect(chunks[1]).toEqual(bytes.subarray(65_536));
  });

  it("rejects an oversized plaintext list before decoding and wipes an owned input", () => {
    const bytes = announcedBytes(Uint8Array.of(1, 2, 3), parameters.plaintextBytes + 1);
    expect(() => decodeCandidateList(bytes)).toThrow(CandidateFileRefusedError);
    expect(() => OpenedCandidateList.fromBytes(bytes)).toThrow(CandidateFileRefusedError);
    expect([...bytes]).toEqual([0, 0, 0]);
  });

  it("joins and wipes small decrypted chunks without cancelling a completed stream", async () => {
    const chunks = [Uint8Array.of(1, 2), Uint8Array.of(3)];
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
      cancel,
    });
    expect(await CandidateFileAdmission.readPlaintext(stream)).toEqual(Uint8Array.of(1, 2, 3));
    expect(chunks.every((chunk) => chunk.every((byte) => byte === 0))).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(stream.locked).toBe(false);
  });
});

describe("Candidate file admission", () => {
  it("checks cumulative decrypted bytes before copying and cancels on overflow", async () => {
    const chunks = [announcedBytes(Uint8Array.of(1), parameters.plaintextBytes), Uint8Array.of(2)];
    let wipedAtCancellation = false;
    const cancel = vi.fn(() => {
      // The chunks are already wiped when cancellation starts, even if it later fails.
      wipedAtCancellation = chunks.every((chunk) => chunk.every((byte) => byte === 0));
      throw new Error("public test cancellation failure");
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
      },
      cancel,
    });
    await expect(CandidateFileAdmission.readPlaintext(stream)).rejects.toMatchObject({
      code: "unsupported",
      message: containing(`limit of ${parameters.plaintextBytes} bytes`),
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(wipedAtCancellation).toBe(true);
    expect(stream.locked).toBe(false);
  });

  it("wipes chunks when authentication fails later in the stream", async () => {
    const chunk = Uint8Array.of(1, 2, 3);
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(chunk);
        } else controller.error(new Error("public test invalid tag"));
      },
    });
    await expect(CandidateFileAdmission.readPlaintext(stream)).rejects.toThrow("invalid tag");
    expect([...chunk]).toEqual([0, 0, 0]);
    expect(stream.locked).toBe(false);
  });

  it("preserves the admission refusal from decrypted output instead of reporting damaged data", async () => {
    const chunk = announcedBytes(Uint8Array.of(7), parameters.plaintextBytes + 1);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
      },
    });
    vi.spyOn(Decrypter.prototype, "decrypt").mockResolvedValue(
      Object.assign(stream, { size: (size: number) => size }),
    );
    await expect(
      decryptCandidates(keyFile(), { identity: vectors.age.identity }),
    ).rejects.toMatchObject({
      code: "unsupported",
    });
    expect([...chunk]).toEqual([0]);
    expect(stream.locked).toBe(false);
  });
});
