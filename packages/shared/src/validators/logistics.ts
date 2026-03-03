import { z } from 'zod';

// ============================================
// Logistics Provider Validators
// ============================================

export const createProviderSchema = z.object({
  name: z.string().min(2).max(200),
  contactInfo: z.string().max(500).optional(),
  coverageArea: z.string().max(500).optional(),
  rateCard: z.record(z.unknown()).optional(),
});
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const updateProviderSchema = z.object({
  providerId: z.string().uuid(),
  name: z.string().min(2).max(200).optional(),
  contactInfo: z.string().max(500).optional(),
  coverageArea: z.string().max(500).optional(),
  rateCard: z.record(z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

export const listProvidersSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListProvidersInput = z.infer<typeof listProvidersSchema>;

// ============================================
// Logistics Location Validators
// ============================================

export const createLocationSchema = z.object({
  providerId: z.string().uuid(),
  name: z.string().min(2).max(200),
  address: z.string().min(5).max(500),
  coordinates: z.string().max(100).optional(),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z.object({
  locationId: z.string().uuid(),
  name: z.string().min(2).max(200).optional(),
  address: z.string().min(5).max(500).optional(),
  coordinates: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const listLocationsSchema = z.object({
  providerId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListLocationsInput = z.infer<typeof listLocationsSchema>;
