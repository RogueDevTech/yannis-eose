import type { CustomFormField } from './types';

/** Stable ascending order + contiguous `order` indices for editor state. */
export function sortAndReindexCustomFields(raw: CustomFormField[]): CustomFormField[] {
  return [...raw]
    .sort((a, b) => a.order - b.order)
    .map((f, i) => ({
      ...f,
      order: i,
      // Legacy / loose JSON: missing `required` is treated as optional
      required: f.required === true,
    }));
}
