import {
  applyCampaignFieldOrderToCustomFields,
  customFieldOrderToken,
  fixedFieldOrderToken,
  normalizeCampaignFieldOrder,
  OFFER_FIELD_ORDER_TOKEN,
  orderStandardFieldsByFieldOrder,
  standardFieldOrderToken,
  type CampaignFieldOrderToken,
} from '@yannis/shared';
import { FIXED_STANDARD_FIELD_KEYS, getStandardFieldLabel, STANDARD_FIELD_LABELS } from './standard-fields';
import type { CustomFormField, StandardFieldConfig, StandardFieldKey } from './types';

export type OrderedPreviewField =
  | {
      token: CampaignFieldOrderToken;
      kind: 'fixed';
      key: 'fullName' | 'phoneNumber' | 'deliveryAddress';
    }
  | {
      token: CampaignFieldOrderToken;
      kind: 'standard';
      key: StandardFieldKey;
      label: string;
      required: boolean;
    }
  | {
      token: CampaignFieldOrderToken;
      kind: 'custom';
      field: CustomFormField;
    }
  | {
      token: CampaignFieldOrderToken;
      kind: 'offer';
    };

export function parseFieldOrderPayload(
  fieldOrderJson: string | undefined,
): { ok: true; fieldOrder: CampaignFieldOrderToken[] } | { ok: false; error: string } {
  const raw = fieldOrderJson?.trim() ?? '[]';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid field order JSON' };
  }
  if (!Array.isArray(parsed) || !parsed.every((token) => typeof token === 'string')) {
    return { ok: false, error: 'fieldOrder must be a JSON string array' };
  }
  return { ok: true, fieldOrder: parsed as CampaignFieldOrderToken[] };
}

export function normalizeBuilderFieldOrder(
  rawFieldOrder: unknown,
  standardFields: StandardFieldConfig[],
  customFields: CustomFormField[],
): CampaignFieldOrderToken[] {
  return normalizeCampaignFieldOrder(rawFieldOrder, standardFields, customFields);
}

export function getOrderedStandardFields(
  standardFields: StandardFieldConfig[],
  fieldOrder: CampaignFieldOrderToken[],
): StandardFieldConfig[] {
  return orderStandardFieldsByFieldOrder(standardFields, fieldOrder);
}

export function getOrderedCustomFields(
  customFields: CustomFormField[],
  fieldOrder: CampaignFieldOrderToken[],
): CustomFormField[] {
  return applyCampaignFieldOrderToCustomFields(customFields, fieldOrder);
}

export function buildOrderedPreviewFields(
  standardFields: StandardFieldConfig[],
  customFields: CustomFormField[],
  fieldOrder: CampaignFieldOrderToken[],
): OrderedPreviewField[] {
  const standardMap = new Map(standardFields.map((field) => [field.key, field]));
  const customMap = new Map(
    getOrderedCustomFields(customFields, fieldOrder).map((field) => [field.id, field]),
  );

  const fixedStdKeys = new Set<string>(FIXED_STANDARD_FIELD_KEYS);

  const result = fieldOrder
    .map((token): OrderedPreviewField | null => {
      if (token === fixedFieldOrderToken('fullName')) {
        return { token, kind: 'fixed', key: 'fullName' };
      }
      if (token === fixedFieldOrderToken('phoneNumber')) {
        return { token, kind: 'fixed', key: 'phoneNumber' };
      }
      if (token === OFFER_FIELD_ORDER_TOKEN) {
        return { token, kind: 'offer' };
      }
      if (token.startsWith('standard.')) {
        const key = token.slice('standard.'.length) as StandardFieldKey;
        // Fixed standard fields render as fixed (always present, always required).
        if (fixedStdKeys.has(key)) {
          return { token, kind: 'fixed', key: key as 'deliveryAddress' };
        }
        const field = standardMap.get(key);
        if (!field) return null;
        return { token, kind: 'standard', key, label: getStandardFieldLabel(field), required: field.required === true };
      }
      if (token.startsWith('custom.')) {
        const field = customMap.get(token.slice('custom.'.length));
        if (!field) return null;
        return { token, kind: 'custom', field };
      }
      return null;
    })
    .filter((field): field is OrderedPreviewField => field != null);

  // Ensure fixed standard fields are present even if missing from fieldOrder
  // (backwards compat for forms created before deliveryAddress became fixed).
  const presentFixedKeys = new Set(result.filter((f) => f.kind === 'fixed').map((f) => f.key));
  for (const key of FIXED_STANDARD_FIELD_KEYS) {
    if (!presentFixedKeys.has(key)) {
      // Insert after phoneNumber (or at end if phoneNumber not found).
      const phoneIdx = result.findIndex((f) => f.kind === 'fixed' && f.key === 'phoneNumber');
      const entry: OrderedPreviewField = {
        token: standardFieldOrderToken(key) as CampaignFieldOrderToken,
        kind: 'fixed',
        key: key as 'deliveryAddress',
      };
      if (phoneIdx >= 0) {
        result.splice(phoneIdx + 1, 0, entry);
      } else {
        result.push(entry);
      }
    }
  }

  return result;
}

export function describeFieldOrderToken(token: CampaignFieldOrderToken): string {
  if (token === fixedFieldOrderToken('fullName')) return 'Full Name';
  if (token === fixedFieldOrderToken('phoneNumber')) return 'Phone Number';
  if (token === standardFieldOrderToken('deliveryAddress')) return 'Delivery Address';
  if (token === OFFER_FIELD_ORDER_TOKEN) return 'Offer selection';
  if (token.startsWith('standard.')) {
    const key = token.slice('standard.'.length) as StandardFieldKey;
    return STANDARD_FIELD_LABELS[key] ?? 'Additional field';
  }
  return 'Custom field';
}

export {
  customFieldOrderToken,
  fixedFieldOrderToken,
  standardFieldOrderToken,
  OFFER_FIELD_ORDER_TOKEN,
  type CampaignFieldOrderToken,
};
