import { z } from 'zod';

/**
 * Save cart — called by Edge Worker when user fills name + phone.
 * Phone comes pre-hashed from the Edge Worker.
 */
export const saveCartSchema = z.object({
  campaignId: z.string().uuid(),
  mediaBuyerId: z.string().uuid().optional(),
  customerName: z.string().min(2, 'Customer name is required'),
  customerPhoneHash: z.string().min(1, 'Phone hash is required'),
  /**
   * Raw phone alongside the hash so the API can persist it for the
   * dropped-off cart reveal flow (CEO directive 2026-05-08). Optional
   * because older Edge Worker builds may still post hash-only payloads.
   */
  customerPhone: z.string().trim().min(4).max(40).optional(),
  productId: z.string().uuid(),
  offerLabel: z.string().max(100).optional(),
});

export type SaveCartInput = z.infer<typeof saveCartSchema>;
