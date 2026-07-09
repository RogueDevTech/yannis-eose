import { z } from 'zod';

// ============================================
// Asset Register & Depreciation Validators
// ============================================

const DEPRECIATION_METHODS = ['STRAIGHT_LINE', 'REDUCING_BALANCE', 'UNITS_OF_PRODUCTION'] as const;
const ASSET_STATUSES = ['ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED'] as const;

export const createAssetSchema = z.object({
  groupId: z.string().uuid().nullish(),
  assetName: z.string().trim().min(1).max(200),
  assetCategory: z.string().trim().min(1).max(100),
  acquisitionDate: z.string().date(),
  cost: z.coerce.number().positive().multipleOf(0.01),
  residualValue: z.coerce.number().nonnegative().multipleOf(0.01).default(0),
  usefulLifeMonths: z.coerce.number().int().positive().optional(),
  depreciationRate: z.coerce.number().positive().max(100).optional(),
  depreciationMethod: z.enum(DEPRECIATION_METHODS).default('STRAIGHT_LINE'),
  location: z.string().trim().max(200).optional(),
  serialNumber: z.string().trim().max(100).optional(),
  invoiceUrl: z.string().url().optional(),
  notes: z.string().trim().max(1000).optional(),
}).refine(
  (d) => {
    if (d.depreciationMethod === 'STRAIGHT_LINE' && !d.usefulLifeMonths) return false;
    if (d.depreciationMethod === 'REDUCING_BALANCE' && !d.depreciationRate) return false;
    return true;
  },
  {
    message:
      'Straight-line requires usefulLifeMonths; reducing balance requires depreciationRate.',
  },
);
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const listAssetsSchema = z.object({
  groupId: z.string().uuid().nullish(),
  status: z.enum(ASSET_STATUSES).optional(),
  category: z.string().trim().max(100).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(500).default(20),
});
export type ListAssetsInput = z.infer<typeof listAssetsSchema>;

export const getAssetSchema = z.object({
  assetId: z.string().uuid(),
});
export type GetAssetInput = z.infer<typeof getAssetSchema>;

export const disposeAssetSchema = z.object({
  assetId: z.string().uuid(),
  disposalDate: z.string().date(),
  proceeds: z.coerce.number().nonnegative().multipleOf(0.01).default(0),
});
export type DisposeAssetInput = z.infer<typeof disposeAssetSchema>;

export const runDepreciationSchema = z.object({
  groupId: z.string().uuid().nullish(),
  /** The last day of the month being depreciated, e.g. '2026-07-31'. */
  periodDate: z.string().date(),
});
export type RunDepreciationInput = z.infer<typeof runDepreciationSchema>;
