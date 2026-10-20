/**
 * Card rendering without any Node.js dependency.
 *
 * A host builds a `CardRenderer` with its `RenderPlatform` once, then passes it to every render,
 * with the same templates and code as the command-line program.
 */
export { CardRenderer } from "./export/card-renderer.js";
export {
  createRasterImage,
  RENDER_ASSETS,
  type QrModules,
  type RasterImage,
  type RenderAsset,
  type RenderPlatform,
} from "./export/platform.js";
export {
  CARD_TEMPLATES,
  selectTemplate,
  templatesOfKind,
  type CardDrawing,
  type CardKind,
  type CardTemplate,
} from "./export/templates.js";
export type { CardContent } from "./export/backup-cards.js";
export { CardSession, createCardSession } from "./export/card-session.js";
export {
  DEFAULT_SHARE_TEMPLATE_ID,
  DEFAULT_TEMPLATE_ID,
  findTemplate,
  NoCardTemplateError,
  resolveTemplateId,
  TEMPLATE_CATALOG,
  type CardStyle,
  type CatalogEntry,
} from "./export/template-catalog.js";
export type { CardCopyOverrides } from "./export/card-copy.js";
export {
  renderCards,
  renderIndividualCards,
  type CardJob,
  type RenderedCard,
} from "./export/render.js";
export {
  CARD_PAGE_SIZES,
  isCardPageSize,
  pageDimensions,
  pageSizeLabel,
  parseOrientation,
  parsePageSize,
  PROFILE_FIELDS,
  SHEET_PAGE_SIZE,
  validateProfile,
  type CardOrientation,
  type CardPageSize,
  type CardProfile,
} from "./export/card-settings.js";
