import type { CardSettings } from './card-settings.js';

export type SskrCardLayout = 'qr' | 'collection' | 'individual';
export interface SskrCardContent extends CardSettings {
  readonly kind: 'sskr';
  readonly colors: readonly string[];
  readonly payload: string;
  readonly collectionReference: string;
  readonly qrCard?: boolean;
  readonly title?: string;
}
