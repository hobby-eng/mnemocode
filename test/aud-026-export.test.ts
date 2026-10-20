import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { afterEach, describe, expect, it } from "vitest";
import { renderIndividualCards } from "../src/export/render.js";
import { exportIndividualCards } from "../src/export/individual-cards.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { SELF_TEST_CARD_DETAILS } from "../src/export/self-test-cards.js";
import { validateProfile } from "../src/export/card-settings.js";
import { ShareCardSet } from "../src/export/sskr-render.js";
import { SSKR_VECTOR } from "../src/sskr/known-answers.js";
import { privateChildPath, publishNewFolder } from "../src/export/private-file.js";
import type { CardContent } from "../src/export/backup-cards.js";
import type { CardTemplate } from "../src/export/templates.js";

const CONTENT: CardContent = {
  kind: "colors",
  colors: Array<string>(12).fill("#468080"),
  labels: [...Array<string>(11).fill("7684"), "5728"],
  payload: [...Array<string>(11).fill("7684"), "5728"].join(" "),
  ...SELF_TEST_CARD_DETAILS,
};
const TEMPLATE: CardTemplate = {
  id: "opaque-test",
  kind: "colors",
  name: "Public opaque fixture",
  description: "No PDF painting",
  render: async () => {
    throw Error("Unexpected sheet rendering");
  },
  renderIndividual: async () => Uint8Array.of(1, 2, 3),
};
const folders: string[] = [];
async function folder(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "mnemocode-aud026-export-"));
  folders.push(value);
  return value;
}
afterEach(async () => {
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("AUD-026 export ownership and admission without PDF painting", () => {
  it("wipes accumulated card bytes on failure and leaves successful outputs owned by the caller", async () => {
    let held: Uint8Array | undefined;
    const failing: CardTemplate = {
      ...TEMPLATE,
      renderIndividual: async (_drawing, _content, index) => {
        if (index === 1) throw Error("Synthetic second card failure");
        held = Uint8Array.of(1, 2, 3);
        return held;
      },
    };
    await expect(renderIndividualCards(nodeCardRenderer, failing, CONTENT)).rejects.toThrow(
      "Synthetic second card failure",
    );
    expect(held).toEqual(new Uint8Array(3));
    const cards = await renderIndividualCards(nodeCardRenderer, TEMPLATE, CONTENT);
    try {
      expect(cards.every((card) => card.bytes[0] === 1)).toBe(true);
    } finally {
      for (const card of cards) card.bytes.fill(0);
    }
  });

  it("rejects manual decoy path traversal before any card is rendered", async () => {
    let renders = 0;
    const directory = await folder();
    const content: CardContent = {
      ...CONTENT,
      colors: [...CONTENT.colors, "#468080"],
      labels: [...CONTENT.labels!, "x/../../escaped"],
      decoys: 1,
    };
    const template: CardTemplate = {
      ...TEMPLATE,
      renderIndividual: async () => {
        renders++;
        return Uint8Array.of(1, 2, 3);
      },
    };
    await expect(
      exportIndividualCards(template, content, join(directory, "cards")),
    ).rejects.toThrow("safe path component");
    expect(renders).toBe(0);
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(["../escape", "x/../../escape", "x\\escape", "..", "x\u0000", "x:", "x.", "CON"])(
    "rejects unsafe child output name %s",
    (name) => {
      expect(() => privateChildPath("owned", name)).toThrow("safe path component");
    },
  );

  it("rejects explicit null share format before assets or randomness", async () => {
    await expect(
      ShareCardSet.create(
        nodeCardRenderer,
        [SSKR_VECTOR.shares[0]!],
        // A null format, which no type allows, fed on purpose as a JavaScript host could.
        { style: "it", shareFormat: null as never, ...SELF_TEST_CARD_DETAILS },
        () => {
          throw Error("Randomness must not run");
        },
      ),
    ).rejects.toThrow("share format");
  });

  it("covers accepted Latin diacritics and punctuation in the bundled font", () => {
    const font = fontkit.create(readFileSync("assets/fonts/DejaVuSans-UI.ttf"));
    for (const name of ["José Silva", "Jean-Luc D’Angelo", "Jean‐Luc"])
      for (const character of validateProfile({ name }).name!)
        expect(font.characterSet).toContain(character.codePointAt(0));
  });
});

describe("AUD-026 folder reservation on all platforms", () => {
  it.each([false, true])("preserves a destination created while staging (%s)", async (nonempty) => {
    const directory = await folder();
    const target = join(directory, "cards");
    let inode = 0;
    await expect(
      publishNewFolder(target, ".staged-", "The destination is taken.", async (staging) => {
        await writeFile(join(staging, "new"), "Public fixture");
        await mkdir(target);
        inode = (await stat(target)).ino;
        if (nonempty) await writeFile(join(target, "keep"), "Keep this public fixture");
      }),
    ).rejects.toThrow("The destination is taken.");
    expect((await stat(target)).ino).toBe(inode);
    expect(await readdir(target)).toEqual(nonempty ? ["keep"] : []);
    expect(await readdir(directory)).toEqual(["cards"]);
  });

  it("publishes complete files into its own private reservation and clears staging", async () => {
    const directory = await folder();
    const target = join(directory, "cards");
    const result = await publishNewFolder(target, ".staged-", "taken", async (staging) => {
      await writeFile(join(staging, "one"), "Public fixture");
      return 7;
    });
    expect(result).toBe(7);
    expect(await readFile(join(target, "one"), "utf8")).toBe("Public fixture");
    expect(await readdir(directory)).toEqual(["cards"]);
    if (process.platform !== "win32") expect((await stat(target)).mode & 0o777).toBe(0o700);
  });

  it("removes failed staging before claiming a destination", async () => {
    const directory = await folder();
    await expect(
      publishNewFolder(join(directory, "cards"), ".staged-", "taken", async (staging) => {
        await writeFile(join(staging, "one"), "Public fixture");
        throw Error("Synthetic write failure");
      }),
    ).rejects.toThrow("Synthetic write failure");
    expect(await readdir(directory)).toEqual([]);
  });
});
