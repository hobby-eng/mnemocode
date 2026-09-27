import type { CardPageSize, CardOrientation } from './card-settings.js';
export const MM = 72 / 25.4;
const BUSINESS_CARD = { width: 90, height: 50, aspect: 1.8 } as const;
const SMALL_LAYOUT = { columnGap: 1.5, rowGap: 4, top: 8, bottomInset: 4, sideInsets: 6 } as const;
const A6_LAYOUT = {
  portraitGap: 4,
  landscapeGap: 3,
  rowGap: 4.5,
  portraitTop: 17,
  landscapeTop: 13,
  shareBottom: 27,
  ordinaryBottom: 22,
  sideInsets: 10,
} as const;
const A4_LAYOUT = { columnGap: 6, columnPitch: 96, rowPitch: 60, top: 27 } as const;
export interface CardBox {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}
export interface BusinessPage {
  width: number;
  height: number;
  cards: CardBox[];
}

/** Coordinates in millimetres, measured from the top left. */
export function businessPages(
  count: number,
  size: CardPageSize,
  orientation?: CardOrientation,
  share = false,
): BusinessPage[] {
  if (
    share
      ? !Number.isInteger(count) || count < 1 || count > 16
      : ![8, 10, 12, 14, 16].includes(count)
  )
    throw new Error('Unsupported number of color references for a business collection.');
  if (orientation !== undefined && orientation !== 'portrait' && orientation !== 'landscape')
    throw new Error('Orientation must be portrait or landscape.');
  if (size === 'wallet' || size === 'business') return smallPages(count, size, orientation);
  if (size === 'a4') return a4Pages(count, orientation);
  if (size !== 'a6') throw new Error('Page size must be a6 or a4.');
  return a6Pages(count, orientation, share);
}

function smallPages(
  count: number,
  size: 'wallet' | 'business',
  orientation?: CardOrientation,
): BusinessPage[] {
  const w = size === 'wallet' ? 85.6 : 90;
  const h = size === 'wallet' ? 54 : 50;
  const portrait = orientation === 'portrait';
  const width = portrait ? h : w;
  const height = portrait ? w : h;
  const columns = portrait ? 3 : 4;
  const rows = Math.ceil(count / columns);
  const gap = SMALL_LAYOUT.columnGap;
  const rowGap = SMALL_LAYOUT.rowGap;
  const top = SMALL_LAYOUT.top;
  const bottom = height - SMALL_LAYOUT.bottomInset;
  const cardHeight = Math.min(
    (width - SMALL_LAYOUT.sideInsets - (columns - 1) * gap) / columns / BUSINESS_CARD.aspect,
    (bottom - top - (rows - 1) * rowGap) / rows,
  );
  const cardWidth = cardHeight * BUSINESS_CARD.aspect;
  const gridHeight = cardHeight * rows + rowGap * (rows - 1);
  return [
    {
      width,
      height,
      cards: Array.from({ length: count }, (_, index) => {
        const row = Math.floor(index / columns);
        const countInRow = Math.min(columns, count - row * columns);
        const rowWidth = cardWidth * countInRow + gap * (countInRow - 1);
        return {
          index,
          x: (width - rowWidth) / 2 + (index % columns) * (cardWidth + gap),
          y: top + (bottom - top - gridHeight) / 2 + row * (cardHeight + rowGap),
          width: cardWidth,
          height: cardHeight,
        };
      }),
    },
  ];
}

function a4Pages(count: number, orientation?: CardOrientation): BusinessPage[] {
  const landscape = orientation === 'landscape';
  const width = landscape ? 297 : 210;
  const height = landscape ? 210 : 297;
  const columns = landscape ? 3 : 2;
  const rows = landscape ? 2 : 4;
  const perPage = columns * rows;
  return Array.from({ length: Math.ceil(count / perPage) }, (_, page) => ({
    width,
    height,
    cards: Array.from({ length: Math.min(perPage, count - page * perPage) }, (_, slot) => ({
      x:
        (width - (columns * BUSINESS_CARD.width + (columns - 1) * A4_LAYOUT.columnGap)) / 2 +
        (slot % columns) * A4_LAYOUT.columnPitch,
      y: A4_LAYOUT.top + Math.floor(slot / columns) * A4_LAYOUT.rowPitch,
      width: BUSINESS_CARD.width,
      height: BUSINESS_CARD.height,
      index: page * perPage + slot,
    })),
  }));
}

function a6Pages(
  count: number,
  orientation: CardOrientation | undefined,
  share: boolean,
): BusinessPage[] {
  const portrait = orientation === 'portrait';
  const pageWidth = portrait ? 105 : 148;
  const pageHeight = portrait ? 148 : 105;
  const columns = portrait ? (count <= 12 ? 2 : 3) : 4;
  const rows = Math.ceil(count / columns);
  const gap = portrait ? A6_LAYOUT.portraitGap : A6_LAYOUT.landscapeGap;
  const rowGap = A6_LAYOUT.rowGap;
  const bodyTop = portrait ? A6_LAYOUT.portraitTop : A6_LAYOUT.landscapeTop;
  const bodyBottom = pageHeight - (share ? A6_LAYOUT.shareBottom : A6_LAYOUT.ordinaryBottom);
  const maxWidth = (pageWidth - A6_LAYOUT.sideInsets - gap * (columns - 1)) / columns;
  const height = Math.min(
    maxWidth / BUSINESS_CARD.aspect,
    (bodyBottom - bodyTop - (rows - 1) * rowGap) / rows,
  );
  const width = height * BUSINESS_CARD.aspect;
  const gridHeight = height * rows + (rows - 1) * rowGap;
  const yStart = bodyTop + (bodyBottom - bodyTop - gridHeight) / 2;
  return [
    {
      width: pageWidth,
      height: pageHeight,
      cards: Array.from({ length: count }, (_, i) => {
        const row = Math.floor(i / columns);
        const rowCount = Math.min(columns, count - row * columns);
        const rowWidth = rowCount * width + (rowCount - 1) * gap;
        return {
          x: (pageWidth - rowWidth) / 2 + (i % columns) * (width + gap),
          y: yStart + row * (height + rowGap),
          width,
          height,
          index: i,
        };
      }),
    },
  ];
}
