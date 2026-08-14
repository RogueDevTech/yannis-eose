import { z } from 'zod';

// ============================================
// Currencies / Country config validators (Multi-currency Phase 1)
// ============================================
// Group-scoped. SUPER_ADMIN/SUPPORT may target any group via optional groupId;
// everyone else is locked to their active group server-side.

/** ISO-4217-ish uppercase code, 3–5 chars (allows a couple of non-ISO edge codes). */
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3,5}$/, 'Currency code must be 3–5 uppercase letters');

export const createCurrencySchema = z.object({
  groupId: z.string().uuid().nullish(),
  code: currencyCode,
  symbol: z.string().trim().min(1).max(8),
  countryName: z.string().trim().min(1).max(100),
  precision: z.coerce.number().int().min(0).max(6).default(2),
  /** Only one default per group; the service enforces/relocates it. */
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
  /** Optional FX at creation (1 unit of THIS = fxRate base units). Usually set later. */
  fxRate: z.coerce.number().positive().nullish(),
});
export type CreateCurrencyInput = z.infer<typeof createCurrencySchema>;

export const updateCurrencySchema = z.object({
  id: z.string().uuid(),
  symbol: z.string().trim().min(1).max(8).optional(),
  countryName: z.string().trim().min(1).max(100).optional(),
  precision: z.coerce.number().int().min(0).max(6).optional(),
  active: z.boolean().optional(),
  // code + isDefault are intentionally NOT editable here:
  //  - code is immutable once orders reference it (frozen currency integrity).
  //  - isDefault flips via a dedicated setDefaultCurrency op (relocates the flag).
});
export type UpdateCurrencyInput = z.infer<typeof updateCurrencySchema>;

/** Set the FX rate for a non-default currency (ratio/reporting lens only). */
export const setFxRateSchema = z.object({
  id: z.string().uuid(),
  /** 1 unit of THIS currency = fxRate units of the group's base currency. */
  fxRate: z.coerce.number().positive(),
});
export type SetFxRateInput = z.infer<typeof setFxRateSchema>;

/** Promote a currency to the group's default (relocates the single default flag). */
export const setDefaultCurrencySchema = z.object({
  id: z.string().uuid(),
});
export type SetDefaultCurrencyInput = z.infer<typeof setDefaultCurrencySchema>;

export const listCurrenciesSchema = z
  .object({
    groupId: z.string().uuid().nullish(),
    /** When true, only active currencies (the dropdown/dormancy source). */
    activeOnly: z.boolean().optional(),
  })
  .default({});
export type ListCurrenciesInput = z.infer<typeof listCurrenciesSchema>;
