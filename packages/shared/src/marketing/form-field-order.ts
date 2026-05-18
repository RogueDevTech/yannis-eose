export const ORDERABLE_FIXED_FIELD_KEYS = ['fullName', 'phoneNumber'] as const;
export type OrderableFixedFieldKey = (typeof ORDERABLE_FIXED_FIELD_KEYS)[number];

export const ORDERABLE_STANDARD_FIELD_KEYS = [
  'gender',
  'deliveryState',
  'deliveryAddress',
  'deliveryNotes',
  'preferredDeliveryDate',
  'customerEmail',
  'paymentMethod',
] as const;
export type OrderableStandardFieldKey = (typeof ORDERABLE_STANDARD_FIELD_KEYS)[number];

export const FIXED_FIELD_ORDER_TOKENS = ['fixed.fullName', 'fixed.phoneNumber'] as const;

export type CampaignFieldOrderToken =
  | `fixed.${OrderableFixedFieldKey}`
  | `standard.${OrderableStandardFieldKey}`
  | `custom.${string}`;

type StandardFieldLike = { key: string };
type CustomFieldLike = { id: string; order?: number | null; required?: boolean };

export function fixedFieldOrderToken(key: OrderableFixedFieldKey): CampaignFieldOrderToken {
  return `fixed.${key}`;
}

export function standardFieldOrderToken(key: OrderableStandardFieldKey): CampaignFieldOrderToken {
  return `standard.${key}`;
}

export function customFieldOrderToken(id: string): CampaignFieldOrderToken {
  return `custom.${id}`;
}

export function defaultCampaignFieldOrder(
  standardFields: StandardFieldLike[],
  customFields: CustomFieldLike[],
): CampaignFieldOrderToken[] {
  const enabledStandardKeys = new Set(
    standardFields
      .map((field) => field.key)
      .filter((key): key is OrderableStandardFieldKey =>
        ORDERABLE_STANDARD_FIELD_KEYS.includes(key as OrderableStandardFieldKey),
      ),
  );

  const customTokens = [...customFields]
    .filter((field): field is CustomFieldLike & { id: string } => typeof field.id === 'string' && field.id.length > 0)
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .map((field) => customFieldOrderToken(field.id));

  return [
    ...FIXED_FIELD_ORDER_TOKENS,
    ...ORDERABLE_STANDARD_FIELD_KEYS.filter((key) => enabledStandardKeys.has(key)).map((key) =>
      standardFieldOrderToken(key),
    ),
    ...customTokens,
  ];
}

export function normalizeCampaignFieldOrder(
  rawFieldOrder: unknown,
  standardFields: StandardFieldLike[],
  customFields: CustomFieldLike[],
): CampaignFieldOrderToken[] {
  const fallback = defaultCampaignFieldOrder(standardFields, customFields);
  if (!Array.isArray(rawFieldOrder)) return fallback;

  const allowed = new Set<string>(fallback);
  const deduped: CampaignFieldOrderToken[] = [];
  for (const token of rawFieldOrder) {
    if (typeof token !== 'string' || !allowed.has(token) || deduped.includes(token as CampaignFieldOrderToken)) {
      continue;
    }
    deduped.push(token as CampaignFieldOrderToken);
  }

  for (const token of fallback) {
    if (!deduped.includes(token)) deduped.push(token);
  }

  return deduped;
}

export function orderStandardFieldsByFieldOrder<T extends StandardFieldLike>(
  standardFields: T[],
  fieldOrder: CampaignFieldOrderToken[],
): T[] {
  const position = new Map<string, number>();
  fieldOrder.forEach((token, index) => {
    if (token.startsWith('standard.')) {
      position.set(token.slice('standard.'.length), index);
    }
  });

  return [...standardFields].sort((a, b) => {
    const aPos = position.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const bPos = position.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    if (aPos !== bPos) return aPos - bPos;
    return ORDERABLE_STANDARD_FIELD_KEYS.indexOf(a.key as OrderableStandardFieldKey) -
      ORDERABLE_STANDARD_FIELD_KEYS.indexOf(b.key as OrderableStandardFieldKey);
  });
}

export function applyCampaignFieldOrderToCustomFields<T extends CustomFieldLike>(
  customFields: T[],
  fieldOrder: CampaignFieldOrderToken[],
): Array<T & { order: number; required: boolean }> {
  const position = new Map<string, number>();
  let nextCustomPosition = 0;
  for (const token of fieldOrder) {
    if (!token.startsWith('custom.')) continue;
    position.set(token.slice('custom.'.length), nextCustomPosition++);
  }

  return [...customFields]
    .filter((field): field is T & { id: string } => typeof field.id === 'string' && field.id.length > 0)
    .sort((a, b) => {
      const aPos = position.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bPos = position.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) return aPos - bPos;
      return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    })
    .map((field, index) => ({
      ...field,
      order: index,
      required: field.required === true,
    }));
}
