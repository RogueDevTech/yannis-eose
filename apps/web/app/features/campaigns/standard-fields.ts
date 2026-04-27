import type { CampaignFormConfig, StandardFieldConfig, StandardFieldKey } from './types';

export const STANDARD_FIELD_LABELS: Record<StandardFieldKey, string> = {
  deliveryAddress: 'Delivery Address',
  deliveryNotes: 'Delivery Notes',
  deliveryState: 'Delivery State',
  gender: 'Gender',
  preferredDeliveryDate: 'Preferred Delivery Date',
  paymentMethod: 'Payment Method',
};

export const STANDARD_FIELD_ORDER: StandardFieldKey[] = [
  'gender',
  'deliveryState',
  'deliveryAddress',
  'deliveryNotes',
  'preferredDeliveryDate',
  'paymentMethod',
];

function isOptionOn(value: boolean | string | undefined): boolean {
  return value === true || value === 'true';
}

function isStandardFieldKey(value: unknown): value is StandardFieldKey {
  return typeof value === 'string' && STANDARD_FIELD_ORDER.includes(value as StandardFieldKey);
}

function readLegacyEnabled(config: CampaignFormConfig, key: StandardFieldKey): boolean {
  switch (key) {
    case 'deliveryAddress':
      return config.showDeliveryAddress !== false && config.showDeliveryAddress !== 'false';
    case 'deliveryNotes':
      return isOptionOn(config.showDeliveryNotes);
    case 'deliveryState':
      return isOptionOn(config.showDeliveryState);
    case 'gender':
      return isOptionOn(config.showGender);
    case 'preferredDeliveryDate':
      return isOptionOn(config.showPreferredDeliveryDate);
    case 'paymentMethod':
      return isOptionOn(config.showPaymentMethod);
  }
}

function readLegacyRequired(config: CampaignFormConfig, key: StandardFieldKey): boolean {
  switch (key) {
    case 'deliveryAddress':
      return isOptionOn(config.requireDeliveryAddress);
    case 'deliveryNotes':
      return isOptionOn(config.requireDeliveryNotes);
    case 'deliveryState':
      return isOptionOn(config.requireDeliveryState);
    case 'gender':
      return isOptionOn(config.requireGender);
    case 'preferredDeliveryDate':
      return isOptionOn(config.requirePreferredDeliveryDate);
    case 'paymentMethod':
      return isOptionOn(config.requirePaymentMethod);
  }
}

export function normalizeStandardFields(config: CampaignFormConfig | null | undefined): StandardFieldConfig[] {
  if (!config) return [];

  const raw = config.standardFields;
  if (Array.isArray(raw)) {
    const dedup = new Map<StandardFieldKey, StandardFieldConfig>();
    for (const item of raw) {
      if (!item || !isStandardFieldKey((item as { key?: unknown }).key)) continue;
      dedup.set(item.key, {
        key: item.key,
        required: item.required === true,
      });
    }
    return STANDARD_FIELD_ORDER.filter((key) => dedup.has(key)).map((key) => dedup.get(key) as StandardFieldConfig);
  }

  return STANDARD_FIELD_ORDER.filter((key) => readLegacyEnabled(config, key)).map((key) => ({
    key,
    required: readLegacyRequired(config, key),
  }));
}

export function toLegacyStandardFieldFlags(fields: StandardFieldConfig[]): Pick<
  CampaignFormConfig,
  | 'showDeliveryAddress'
  | 'showDeliveryNotes'
  | 'showDeliveryState'
  | 'showGender'
  | 'showPreferredDeliveryDate'
  | 'showPaymentMethod'
  | 'requireDeliveryAddress'
  | 'requireDeliveryNotes'
  | 'requireDeliveryState'
  | 'requireGender'
  | 'requirePreferredDeliveryDate'
  | 'requirePaymentMethod'
> {
  const has = new Set(fields.map((f) => f.key));
  const required = new Set(fields.filter((f) => f.required).map((f) => f.key));

  return {
    showDeliveryAddress: has.has('deliveryAddress'),
    showDeliveryNotes: has.has('deliveryNotes'),
    showDeliveryState: has.has('deliveryState'),
    showGender: has.has('gender'),
    showPreferredDeliveryDate: has.has('preferredDeliveryDate'),
    showPaymentMethod: has.has('paymentMethod'),
    requireDeliveryAddress: required.has('deliveryAddress'),
    requireDeliveryNotes: required.has('deliveryNotes'),
    requireDeliveryState: required.has('deliveryState'),
    requireGender: required.has('gender'),
    requirePreferredDeliveryDate: required.has('preferredDeliveryDate'),
    requirePaymentMethod: required.has('paymentMethod'),
  };
}

export function parseStandardFieldsPayload(
  standardFieldsJson: string | undefined,
): { ok: true; fields: StandardFieldConfig[] } | { ok: false; error: string } {
  const raw = standardFieldsJson?.trim() || '[]';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid standardFields JSON' };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'standardFields must be a JSON array' };
  }

  const dedup = new Map<StandardFieldKey, StandardFieldConfig>();
  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i] as { key?: unknown; required?: unknown } | null;
    if (!row || !isStandardFieldKey(row.key)) {
      return { ok: false, error: `Standard field ${i + 1} has an invalid key` };
    }
    dedup.set(row.key, { key: row.key, required: row.required === true });
  }

  return {
    ok: true,
    fields: STANDARD_FIELD_ORDER.filter((key) => dedup.has(key)).map((key) => dedup.get(key) as StandardFieldConfig),
  };
}
