import type { CardPageSize, CardOrientation } from './card-settings.js';

const WALLET = { width: 85.6, height: 54 } as const;
const GRID = {
  portraitColumns: 3,
  landscapeColumns: 4,
  margin: 3.5,
  gap: 1.4,
  top: 12.3,
  bottom: 5,
} as const;

export function materialPageLayout(size: CardPageSize, orientation?: CardOrientation) {
  // Rotate the physical sheet, never stretch the photographed finishes.
  const dimensions =
    size === 'a4'
      ? [297, 210]
      : size === 'a6'
        ? [148, 105]
        : size === 'business'
          ? [90, 50]
          : [85.6, 54];
  if (orientation === 'portrait') dimensions.reverse();
  else if (orientation !== undefined && orientation !== 'landscape')
    throw new Error('Orientation must be portrait or landscape.');
  const width = dimensions[0]!;
  const height = dimensions[1]!;
  const portrait = height > width;
  const scale = portrait
    ? Math.min(width / WALLET.height, height / WALLET.width)
    : Math.min(width / WALLET.width, height / WALLET.height);
  return { width, height, portrait, scale };
}

export function materialGridLayout(
  width: number,
  height: number,
  scale: number,
  portrait: boolean,
  count: number,
  individual?: number,
) {
  const columns =
    individual === undefined ? (portrait ? GRID.portraitColumns : GRID.landscapeColumns) : 1;
  const rows = Math.ceil(count / columns);
  const margin = GRID.margin * scale;
  const gap = GRID.gap * scale;
  const areaTop = GRID.top * scale;
  const areaBottom = height - GRID.bottom * scale;
  const cellHeight = (areaBottom - areaTop) / rows;
  const cellWidth = (width - 2 * margin - (columns - 1) * gap) / columns;
  return { columns, rows, cellHeight, cellWidth, gap, areaTop };
}
