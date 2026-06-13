import type { CampaignFormConfig, StandardFieldConfig, StandardFieldKey } from './types';

export const STANDARD_FIELD_LABELS: Record<StandardFieldKey, string> = {
  deliveryAddress: 'Delivery Address',
  deliveryNotes: 'Delivery Notes',
  deliveryState: 'Delivery State',
  gender: 'Gender',
  preferredDeliveryDate: 'Preferred Delivery Date',
  customerEmail: 'Email',
  paymentMethod: 'Payment Method',
};

/**
 * Fields that are always present and required on every form — not toggleable.
 * CEO 2026-05-25: deliveryAddress is a basic required field like fullName/phoneNumber.
 * CEO 2026-05-26: deliveryState is now also fixed-required — buyers must select their state.
 */
export const FIXED_STANDARD_FIELD_KEYS: readonly StandardFieldKey[] = ['deliveryAddress', 'deliveryState'];

export const STANDARD_FIELD_ORDER: StandardFieldKey[] = [
  'gender',
  'deliveryState',
  'deliveryAddress',
  'deliveryNotes',
  'preferredDeliveryDate',
  'customerEmail',
  'paymentMethod',
];

/** Standard fields that can be toggled on/off in the form builder. */
export const TOGGLEABLE_STANDARD_FIELD_ORDER: StandardFieldKey[] = STANDARD_FIELD_ORDER.filter(
  (key) => !(FIXED_STANDARD_FIELD_KEYS as readonly string[]).includes(key),
);

const MAX_STANDARD_FIELD_LABEL_LENGTH = 120;

/** Additional fields whose dropdown choices can be edited (defaults match the Edge Worker). */
export const ADDITIONAL_FIELD_OPTION_KEYS: readonly StandardFieldKey[] = ['gender', 'deliveryState', 'preferredDeliveryDate'];

/** Nigerian states + FCT — same default list as `apps/edge-worker` hosted form. */
export const DEFAULT_DELIVERY_STATE_OPTIONS: string[] = [
  'Lagos',
  'Abuja (FCT)',
  'Rivers',
  'Oyo',
  'Kano',
  'Delta',
  'Edo',
  'Ogun',
  'Anambra',
  'Enugu',
  'Kaduna',
  'Imo',
  'Abia',
  'Kwara',
  'Osun',
  'Ondo',
  'Ekiti',
  'Bayelsa',
  'Cross River',
  'Akwa Ibom',
  'Plateau',
  'Benue',
  'Nasarawa',
  'Niger',
  'Kogi',
  'Taraba',
  'Adamawa',
  'Bauchi',
  'Gombe',
  'Borno',
  'Yobe',
  'Jigawa',
  'Zamfara',
  'Sokoto',
  'Kebbi',
  'Katsina',
  'Ebonyi',
];

export const DEFAULT_PREFERRED_DELIVERY_DATE_OPTIONS: string[] = [
  'Today',
  'Tomorrow',
  'Within 3 days',
];

export const DEFAULT_GENDER_OPTIONS: string[] = ['Male', 'Female'];

export interface AdditionalFieldSelectOptionsState {
  deliveryStateOptions: string[];
  preferredDeliveryDateOptions: string[];
  genderOptions: string[];
}

export function cloneDefaultAdditionalFieldSelectOptions(): AdditionalFieldSelectOptionsState {
  return {
    deliveryStateOptions: [...DEFAULT_DELIVERY_STATE_OPTIONS],
    preferredDeliveryDateOptions: [...DEFAULT_PREFERRED_DELIVERY_DATE_OPTIONS],
    genderOptions: [...DEFAULT_GENDER_OPTIONS],
  };
}

/** Load saved lists when present; otherwise show defaults in the builder (matches Edge fallbacks when arrays are empty). */
export function additionalFieldSelectOptionsFromConfig(
  config: CampaignFormConfig | null | undefined,
): AdditionalFieldSelectOptionsState {
  const base = cloneDefaultAdditionalFieldSelectOptions();
  if (!config) return base;
  if (config.deliveryStateOptions && config.deliveryStateOptions.length > 0) {
    base.deliveryStateOptions = [...config.deliveryStateOptions];
  }
  if (config.preferredDeliveryDateOptions && config.preferredDeliveryDateOptions.length > 0) {
    base.preferredDeliveryDateOptions = [...config.preferredDeliveryDateOptions];
  }
  if (config.genderOptions && config.genderOptions.length > 0) {
    base.genderOptions = [...config.genderOptions];
  }
  return base;
}

export function parseOptionLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinOptionLines(opts: string[]): string {
  return opts.join('\n');
}

export function getDefaultStandardFieldLabel(key: StandardFieldKey): string {
  return STANDARD_FIELD_LABELS[key];
}

export function getStandardFieldLabel(field: Pick<StandardFieldConfig, 'key' | 'label'>): string {
  const trimmed = field.label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : getDefaultStandardFieldLabel(field.key);
}

function normalizeStandardFieldConfig(input: {
  key: StandardFieldKey;
  required?: boolean;
  label?: string | null | undefined;
}): StandardFieldConfig {
  const rawLabel = typeof input.label === 'string' ? input.label.trim() : '';
  return {
    key: input.key,
    label:
      rawLabel.length > 0
        ? rawLabel.slice(0, MAX_STANDARD_FIELD_LABEL_LENGTH)
        : getDefaultStandardFieldLabel(input.key),
    required: input.required === true,
  };
}

const MAX_OPT_LEN = 100;
const MAX_STATE_OPTS = 50;
const MAX_SHORT_OPTS = 20;

function readOptionArray(raw: unknown, maxItems: number): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return null;
    const t = item.trim();
    if (!t) continue;
    if (t.length > MAX_OPT_LEN) return null;
    out.push(t);
    if (out.length > maxItems) return null;
  }
  return out;
}

export function parseAdditionalFieldSelectOptionsPayload(
  json: string | undefined,
): { ok: true; options: AdditionalFieldSelectOptionsState } | { ok: false; error: string } {
  const raw = json?.trim();
  if (!raw) {
    return { ok: true, options: cloneDefaultAdditionalFieldSelectOptions() };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid additional field options JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'additionalFieldSelectOptions must be a JSON object' };
  }
  const o = parsed as Record<string, unknown>;
  const states = readOptionArray(o.deliveryStateOptions, MAX_STATE_OPTS);
  const dates = readOptionArray(o.preferredDeliveryDateOptions, MAX_SHORT_OPTS);
  const genders = readOptionArray(o.genderOptions, MAX_SHORT_OPTS);
  if (states === null || dates === null || genders === null) {
    return { ok: false, error: 'Invalid option lists (strings only, within size limits)' };
  }
  return {
    ok: true,
    options: {
      deliveryStateOptions: states,
      preferredDeliveryDateOptions: dates,
      genderOptions: genders,
    },
  };
}

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
    case 'customerEmail':
      return isOptionOn(config.showCustomerEmail);
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
    case 'customerEmail':
      return isOptionOn(config.requireCustomerEmail);
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
      dedup.set(
        item.key,
        normalizeStandardFieldConfig({
          key: item.key,
          label: (item as { label?: unknown }).label as string | undefined,
          required: item.required === true,
        }),
      );
    }
    return STANDARD_FIELD_ORDER.filter((key) => dedup.has(key)).map((key) => dedup.get(key) as StandardFieldConfig);
  }

  return STANDARD_FIELD_ORDER.filter((key) => readLegacyEnabled(config, key)).map((key) => ({
    key,
    label: getDefaultStandardFieldLabel(key),
    required: readLegacyRequired(config, key),
  }));
}

/**
 * Ensures fixed standard fields (deliveryAddress) are always present and required.
 * Call this before saving — guarantees every form includes them regardless of
 * whether the user toggled them in an older builder version.
 */
export function ensureFixedStandardFields(fields: StandardFieldConfig[]): StandardFieldConfig[] {
  const existing = new Map(fields.map((f) => [f.key, f]));
  for (const key of FIXED_STANDARD_FIELD_KEYS) {
    if (!existing.has(key)) {
      existing.set(key, { key, label: getDefaultStandardFieldLabel(key), required: true });
    } else {
      // Force required even if user somehow set it to optional.
      const field = existing.get(key)!;
      existing.set(key, { ...field, required: true });
    }
  }
  // Maintain canonical order.
  return STANDARD_FIELD_ORDER.filter((k) => existing.has(k)).map((k) => existing.get(k)!);
}

export function toLegacyStandardFieldFlags(fields: StandardFieldConfig[]): Pick<
  CampaignFormConfig,
  | 'showDeliveryAddress'
  | 'showDeliveryNotes'
  | 'showDeliveryState'
  | 'showGender'
  | 'showPreferredDeliveryDate'
  | 'showCustomerEmail'
  | 'showPaymentMethod'
  | 'requireDeliveryAddress'
  | 'requireDeliveryNotes'
  | 'requireDeliveryState'
  | 'requireGender'
  | 'requirePreferredDeliveryDate'
  | 'requireCustomerEmail'
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
    showCustomerEmail: has.has('customerEmail'),
    showPaymentMethod: has.has('paymentMethod'),
    requireDeliveryAddress: required.has('deliveryAddress'),
    requireDeliveryNotes: required.has('deliveryNotes'),
    requireDeliveryState: required.has('deliveryState'),
    requireGender: required.has('gender'),
    requirePreferredDeliveryDate: required.has('preferredDeliveryDate'),
    requireCustomerEmail: required.has('customerEmail'),
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
    return { ok: false, error: 'Invalid additional fields JSON (standardFields)' };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'additionalFields payload (standardFields) must be a JSON array' };
  }

  const dedup = new Map<StandardFieldKey, StandardFieldConfig>();
  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i] as { key?: unknown; label?: unknown; required?: unknown } | null;
    if (!row || !isStandardFieldKey(row.key)) {
      return { ok: false, error: `Additional field ${i + 1} has an invalid key` };
    }
    if (row.label !== undefined && (typeof row.label !== 'string' || row.label.trim().length === 0)) {
      return { ok: false, error: `Additional field ${i + 1} has an invalid label` };
    }
    if (typeof row.label === 'string' && row.label.trim().length > MAX_STANDARD_FIELD_LABEL_LENGTH) {
      return { ok: false, error: `Additional field ${i + 1} label is too long` };
    }
    dedup.set(
      row.key,
      normalizeStandardFieldConfig({
        key: row.key,
        label: typeof row.label === 'string' ? row.label : undefined,
        required: row.required === true,
      }),
    );
  }

  return {
    ok: true,
    fields: STANDARD_FIELD_ORDER.filter((key) => dedup.has(key)).map((key) => dedup.get(key) as StandardFieldConfig),
  };
}
