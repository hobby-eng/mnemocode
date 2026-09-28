import { isCardPageSize, type CardPageSize, type CardSettings } from './card-settings.js';

export type SskrCardLayout = 'qr' | 'collection' | 'individual';
/**
 * The page size decides the layout, as for ordinary cards: a sheet size gives one
 * collection sheet per share, a card size gives separate numbered cards. A QR card
 * holds one whole share and is available in every size.
 */
export function resolveSskrLayout(
  requested: SskrCardLayout | undefined,
  pageSize: CardPageSize | undefined,
): SskrCardLayout {
  if (requested === 'qr') return 'qr';
  const cards = isCardPageSize(pageSize);
  if (requested === 'collection' && cards)
    throw new Error(
      'A wallet or business page size gives separate cards. Use --page-size a6 or a4 for a collection sheet.',
    );
  if (requested === 'individual' && pageSize !== undefined && !cards)
    throw new Error('Separate cards need a card size. Use --page-size wallet or business.');
  return requested ?? (cards ? 'individual' : 'collection');
}

export interface SskrCardContent extends CardSettings {
  readonly kind: 'sskr';
  readonly colors: readonly string[];
  readonly payload: string;
  readonly collectionReference: string;
  readonly qrCard?: boolean;
  readonly title?: string;
}
