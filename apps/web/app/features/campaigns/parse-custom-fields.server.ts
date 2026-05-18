import { customFormFieldSchema } from '@yannis/shared/validators';
import type { CustomFormField } from './types';

const MAX_CUSTOM_FIELDS = 50;

/**
 * Parse and validate `customFields` JSON from Remix formData (create / edit campaign form).
 */
export function parseCustomFieldsPayload(
  customFieldsJson: string | undefined,
): { ok: true; fields: CustomFormField[] } | { ok: false; error: string } {
  const raw = customFieldsJson ?? '[]';
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid customFields JSON' };
  }

  if (!Array.isArray(parsedJson)) {
    return { ok: false, error: 'customFields must be a JSON array' };
  }
  if (parsedJson.length > MAX_CUSTOM_FIELDS) {
    return { ok: false, error: `At most ${MAX_CUSTOM_FIELDS} custom fields allowed` };
  }

  const fields: CustomFormField[] = [];
  for (let i = 0; i < parsedJson.length; i++) {
    const row = customFormFieldSchema.safeParse(parsedJson[i]);
    if (!row.success) {
      const msg = row.error.issues.map((e) => e.message).join('; ') || 'Invalid custom field';
      return { ok: false, error: `Field ${i + 1}: ${msg}` };
    }
    fields.push(row.data as CustomFormField);
  }
  return { ok: true, fields };
}
