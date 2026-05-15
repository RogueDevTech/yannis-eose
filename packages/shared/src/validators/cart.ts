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
  // Progressive form-field capture (migration 0142). Edge Worker sends each
  // value as the customer types it; service merges into the existing PENDING row.
  // All optional — partial submissions are expected (that's the whole point).
  customerEmail: z.string().trim().max(120).optional(),
  customerAddress: z.string().trim().max(500).optional(),
  deliveryAddress: z.string().trim().max(500).optional(),
  deliveryState: z.string().trim().max(80).optional(),
  deliveryNotes: z.string().trim().max(1000).optional(),
  customerGender: z.string().trim().max(20).optional(),
  preferredDeliveryDate: z.string().trim().max(20).optional(),
  paymentMethod: z.string().trim().max(40).optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  customFieldValues: z.record(z.string(), z.unknown()).optional(),
});

export type SaveCartInput = z.infer<typeof saveCartSchema>;
