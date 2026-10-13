/** Manual public-data rendering check; not part of normal CLI startup or CI. */
// Usage: node scripts/business-goldens.mjs [module root] [destination]; compare two destinations
// with scripts/compare-business-goldens.py.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadCardRenderer,
  officialShareContent,
  ordinaryContent,
  REVIEW_TEXTS,
} from "./card-fixtures.mjs";
const moduleRoot = resolve(process.argv[2] ?? ".");
const destination = resolve(process.argv[3] ?? "goldens/after");
const renderer = await loadCardRenderer(moduleRoot);
const ordinary = (bytes, pageSize) => ordinaryContent(renderer, bytes, pageSize);
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
  ...REVIEW_TEXTS,
};
const fixed = (content) => ({ ...content, profile, presentation });
const fixtures = [
  ["words12-a6", "it", ordinary(16, "a6")],
  ["words24-a4", "mixed", ordinary(32, "a4")],
  ["single-business", "curves", ordinary(16, "business"), 2],
  ["sskr-qr", "it", officialShareContent(renderer), 0],
];
await mkdir(destination, { recursive: true });
for (const [name, style, content, index] of fixtures) {
  await writeFile(
    resolve(destination, name + ".pdf"),
    await renderer.renderBusinessCards(style, fixed(content), index),
  );
  console.log(name);
}

await writeFile(
  resolve(destination, "material.pdf"),
  await renderer.renderMaterialCard("tile", fixed({ ...ordinary(32, "business"), cardQr: true })),
);
console.log("material");
