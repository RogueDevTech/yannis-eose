import { z } from 'zod';

export const pageKeySchema = z.string().min(1).max(200).regex(/^[a-z0-9._-]+$/);

export const filterValueSchema = z.record(z.string(), z.string());

export const upsertFilterPreferenceSchema = z.object({
  pageKey: pageKeySchema,
  filters: filterValueSchema,
});
export type UpsertFilterPreferenceInput = z.infer<typeof upsertFilterPreferenceSchema>;

export const deleteFilterPreferenceSchema = z.object({
  pageKey: pageKeySchema,
});
export type DeleteFilterPreferenceInput = z.infer<typeof deleteFilterPreferenceSchema>;

export const getFilterPreferenceSchema = z.object({
  pageKey: pageKeySchema,
});
export type GetFilterPreferenceInput = z.infer<typeof getFilterPreferenceSchema>;
