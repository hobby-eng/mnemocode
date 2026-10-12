import {
  pageDimensions,
  parseOrientation,
  type CardOrientation,
  type CardPageSize,
  ID1_CARD_MM,
} from "./card-settings.js";
import { runCellSize } from "./business-layout.js";

// The material layout was drawn for a card of 85.6 x 54 mm and is scaled to the page.
const DRAWN_FOR = ID1_CARD_MM;
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
  // Material sheets lie on their long side unless portrait is asked for; an orientation that is
  // given is checked as every family checks it, so that null is refused, not taken as none.
  const [width, height] = pageDimensions(size, parseOrientation(orientation) ?? "landscape");
  const portrait = height > width;
  const scale = portrait
    ? Math.min(width / DRAWN_FOR.height, height / DRAWN_FOR.width)
    : Math.min(width / DRAWN_FOR.width, height / DRAWN_FOR.height);
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
  const cellWidth = runCellSize(width - 2 * margin, columns, gap);
  return { columns, rows, cellHeight, cellWidth, gap, areaTop };
}
