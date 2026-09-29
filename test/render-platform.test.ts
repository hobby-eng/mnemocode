import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cardTemplates,
  configureRenderPlatform,
  renderAssets,
  renderCards,
  renderIndividualCards,
  selectTemplate,
  type CardContent,
  type RenderPlatform,
} from '../src/cards.js';
import { nodeRenderPlatform } from '../src/export/platform-node.js';
import { indexesToColors } from '../src/core.js';

const source = fileURLToPath(new URL('../src/', import.meta.url));
const assets = fileURLToPath(new URL('../assets/', import.meta.url));

/** Every module reachable from an entry point, with the packages each one imports. */
function importGraph(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (graph.has(file)) continue;
    const text = readFileSync(join(source, file), 'utf8');
    const packages: string[] = [];
    for (const match of text.matchAll(
      /(?:\b(?:import|export)\b[^;'"]*?\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gmu,
    )) {
      const specifier = match[1]!;
      if (specifier.startsWith('.'))
        pending.push(normalize(join(dirname(file), specifier.replace(/\.js$/u, '.ts'))));
      else packages.push(specifier);
    }
    graph.set(file, packages);
  }
  return graph;
}

const content: CardContent = {
  kind: 'colors',
  colors: indexesToColors(Array.from({ length: 12 }, (_, index) => index)),
  payload: indexesToColors(Array.from({ length: 12 }, (_, index) => index)).join(' '),
  pageSize: 'a6',
  cardQr: true,
};

describe('platform-neutral card rendering', () => {
  it('keeps Node.js and Node-only packages out of the host entry point', () => {
    const allowed = new Set([
      'pdf-lib',
      '@pdf-lib/fontkit',
      '@scure/bip39',
      '@scure/bip39/wordlists/english.js',
      '@scure/bip39/wordlists/traditional-chinese.js',
    ]);
    const graph = importGraph('cards.ts');
    expect(graph.has(normalize('export/templates.ts'))).toBe(true);
    for (const [file, packages] of graph)
      for (const specifier of packages)
        expect(allowed.has(specifier), `${file} imports ${specifier}`).toBe(true);
    expect([...graph.keys()].some((file) => file.includes('platform-node'))).toBe(false);
  });

  it('lists exactly the bundled files the renderers can request', () => {
    for (const path of renderAssets) expect(existsSync(join(assets, path)), path).toBe(true);
    const requested = new Set<string>();
    for (const file of importGraph('cards.ts').keys()) {
      const text = readFileSync(join(source, file), 'utf8');
      for (const match of text.matchAll(/readRenderAsset\(\s*[`']([^`']+)[`']/gu))
        requested.add(match[1]!);
    }
    const patterns = [...requested].map(
      (path) =>
        new RegExp(`^${path.replace(/\$\{[^}]+\}/gu, '[a-z0-9-]+').replace(/\./gu, '\\.')}$`, 'u'),
    );
    expect(patterns.length).toBeGreaterThan(0);
    for (const path of renderAssets)
      expect(
        patterns.some((pattern) => pattern.test(path)),
        path,
      ).toBe(true);
  });

  it('renders through the platform supplied by the host', async () => {
    const calls = { assets: new Set<string>(), random: 0, decode: 0, encode: 0, qr: 0 };
    const host: RenderPlatform = {
      readAsset: (path) => {
        calls.assets.add(path);
        return nodeRenderPlatform.readAsset(path);
      },
      randomInt: (limit) => {
        calls.random += 1;
        return limit - 1;
      },
      decodePng: (bytes) => {
        calls.decode += 1;
        return nodeRenderPlatform.decodePng(bytes);
      },
      encodePng: (image, level) => {
        calls.encode += 1;
        return nodeRenderPlatform.encodePng(image, level);
      },
      qrModules: (payload) => {
        calls.qr += 1;
        return nodeRenderPlatform.qrModules(payload);
      },
    };
    configureRenderPlatform(host);
    try {
      const template = selectTemplate('business-it', 'colors');
      const bytes = await renderCards([{ template, content: { ...content } }]);
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
      expect(calls.assets).toContain('fonts/DejaVuSans-UI.ttf');
      expect(calls.assets).toContain('images/business-it-v1.png');
      expect(calls.random).toBeGreaterThan(0);
      expect(calls.encode).toBeGreaterThan(0);
      expect(calls.qr).toBeGreaterThan(0);
      // Separate cards have the business size, not the sheet size used above.
      const cards = await renderIndividualCards(template, {
        ...content,
        pageSize: 'business',
        cardQr: false,
      });
      expect(cards.map((card) => card.name)).toEqual(
        content.colors.map(
          (color, index) => `${String(index + 1).padStart(2, '0')}-${color.slice(1).toUpperCase()}`,
        ),
      );
    } finally {
      configureRenderPlatform(nodeRenderPlatform);
    }
  });

  it('offers every template to a host', () => {
    expect(cardTemplates).toHaveLength(16);
    expect(new Set(cardTemplates.map((template) => template.id)).size).toBe(16);
  });
});
