/** Manual public-data rendering check; not part of normal CLI startup or CI. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
const moduleRoot = resolve(process.argv[2] ?? ".");
const destination = resolve(process.argv[3] ?? "goldens/after");
const { representMnemonic, indexesToColors } = await import(
  pathToFileURL(resolve(moduleRoot, "dist/core.js"))
);
const { renderBusinessCards } = await import(
  pathToFileURL(resolve(moduleRoot, "dist/export/business-cards.js"))
);
const vector = JSON.parse(await readFile(resolve(moduleRoot, "vectors/sskr-v1.json"), "utf8"));
function ordinary(bytes, pageSize) {
  const mnemonic = entropyToMnemonic(
    Uint8Array.from({ length: bytes }, (_, i) => i),
    wordlist,
  );
  const colors = indexesToColors(representMnemonic(mnemonic).shiftedIndexes);
  return { kind: "colors", colors, payload: colors.join(" "), pageSize };
}
const profile = {
  name: "Alex Morgan",
  company: "Northline",
  role: "Property Consultant",
  email: "alex@northline.com",
  website: "northline.com",
  phone: "+44 20 7946 0281",
  location: "London",
};
const presentation = {
  studioName: "Alder & Vale",
  slogan: "Print, done properly.",
  subtitle: "Colour options for review.",
  footer: "CLIENT REVIEW",
  referenceLabel: "Ref.",
};
const fixed = (content) => ({ ...content, profile, presentation });
const { renderGlassCards } = await import(
  pathToFileURL(resolve(moduleRoot, "dist/export/glass-cards.js"))
);
const { renderMaterialCard } = await import(
  pathToFileURL(resolve(moduleRoot, "dist/export/material-cards.js"))
);
const colors = vector.official.firstShareColors;
const fixtures = [
  ["words12-a6", "it", ordinary(16, "a6")],
  ["words24-a4", "mixed", ordinary(32, "a4")],
  ["single-business", "curves", ordinary(16, "business"), 2],
  [
    "sskr-qr",
    "it",
    {
      kind: "sskr",
      colors,
      payload: colors.join(" "),
      collectionReference: "PUBLIC-1-1",
      qrCard: true,
      pageSize: "business",
    },
    0,
  ],
];
await mkdir(destination, { recursive: true });
for (const [name, style, content, index] of fixtures) {
  await writeFile(
    resolve(destination, name + ".pdf"),
    await renderBusinessCards(style, fixed(content), index),
  );
  console.log(name);
}

await writeFile(
  resolve(destination, "glass8.pdf"),
  await renderGlassCards(fixed({ ...ordinary(32, "wallet"), cardQr: true }), 0, 8),
);
await writeFile(
  resolve(destination, "material.pdf"),
  await renderMaterialCard("tile", fixed({ ...ordinary(32, "wallet"), cardQr: true })),
);
