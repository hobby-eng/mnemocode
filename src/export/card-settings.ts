/** Print layout is independent of the visual template and the encoded format. */
export type CardPageSize = 'a6' | 'a4' | 'wallet' | 'business';
export type CardOrientation = 'portrait' | 'landscape';
export interface CardProfile {
  readonly name?: string;
  readonly role?: string;
  readonly company?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly website?: string;
  readonly location?: string;
}
export interface CardPresentation {
  readonly studioName: string;
  readonly slogan: string;
  readonly subtitle: string;
  readonly footer: string;
  readonly referenceLabel: string;
}
export interface CardSettings {
  readonly pageSize?: CardPageSize;
  readonly orientation?: CardOrientation;
  readonly profile?: CardProfile;
  readonly presentation?: CardPresentation;
  readonly cardQr?: boolean;
}
export const profileFields = [
  'name',
  'role',
  'company',
  'email',
  'phone',
  'website',
  'location',
] as const;
export type BusinessStyle =
  'architect' | 'it' | 'estate' | 'diagonal' | 'contact' | 'curves' | 'facets' | 'mixed';

export function parsePageSize(value: string | undefined): CardPageSize {
  if (value === undefined) return 'a6';
  if (!['a6', 'a4', 'wallet', 'business'].includes(value))
    throw new Error('Page size must be a6, a4, wallet, or business.');
  return value as CardPageSize;
}

export function parseOrientation(value: string | undefined): CardOrientation | undefined {
  if (value === undefined || value === 'portrait' || value === 'landscape') return value;
  throw new Error('Orientation must be portrait or landscape.');
}

export function validateProfile(profile: CardProfile = {}): CardProfile {
  const result: Record<string, string> = {};
  for (const field of profileFields) {
    const text = profile[field];
    if (text === undefined) continue;
    if (typeof text !== 'string' || !text.trim() || /[\p{Cc}\p{Cf}]/u.test(text)) {
      throw new Error(
        `Card ${field} must be non-empty text on one line, without control characters.`,
      );
    }
    if ([...text].length > 100)
      throw new Error(`Card ${field} is too long (maximum 100 characters).`);
    const normalized = text.trim().normalize('NFC');
    if (
      field === 'name' &&
      (!/\p{Script=Latin}/u.test(normalized) ||
        !/^[\p{Script=Latin}\p{M} .’'‐-]+$/u.test(normalized))
    ) {
      throw new Error(
        'Card name must use Latin letters only (spaces, apostrophes and hyphens are allowed).',
      );
    }
    result[field] = normalized;
  }
  return result;
}

function defaultEmployer(
  style: BusinessStyle,
): Pick<Required<CardProfile>, 'role' | 'company' | 'email' | 'website' | 'location'> {
  if (style === 'architect') {
    return {
      role: 'ARCHITECT',
      company: 'VECTOR STUDIO',
      email: 'alex@vector.com',
      website: 'vector.com',
      location: 'Remote / Worldwide',
    };
  }
  if (style === 'it') {
    return {
      role: 'IT SOLUTIONS DIRECTOR',
      company: 'VECTOR SYSTEMS',
      email: 'alex@vector.com',
      website: 'vector.com',
      location: 'Remote / Worldwide',
    };
  }
  return {
    role: 'Property Consultant',
    company: 'NORTHLINE',
    email: 'alex@northline.com',
    website: 'northline.com',
    location: 'London / International',
  };
}

export function resolveProfile(
  style: BusinessStyle,
  supplied?: CardProfile,
): Required<CardProfile> {
  return {
    name: 'Alex Morgan',
    phone: '+44 20 7946 0281',
    ...defaultEmployer(style),
    ...validateProfile(supplied),
  };
}
