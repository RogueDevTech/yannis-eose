import { z } from 'zod';

/**
 * Save cart — called by Edge Worker when the customer enters a valid phone.
 * Phone comes pre-hashed from the Edge Worker. Product/offer and other fields
 * are progressive and may arrive on later saves.
 */
export const saveCartSchema = z.object({
  campaignId: z.string().uuid(),
  mediaBuyerId: z.string().uuid().optional(),
  /** Name is optional — phone alone is enough to capture a cart. Defaults to "Unknown" when absent. */
  customerName: z.string().min(1).optional().default('Unknown'),
  customerPhoneHash: z.string().min(1, 'Phone hash is required'),
  /**
   * Raw phone alongside the hash so the API can persist it for the
   * dropped-off cart reveal flow (CEO directive 2026-05-08). Optional
   * because older Edge Worker builds may still post hash-only payloads.
   */
  customerPhone: z.string().trim().min(4).max(40).optional(),
  /** Optional at first save — phone-only capture; merged when the customer picks a product. */
  productId: z.string().uuid().optional(),
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
  /**
   * Form Analytics attribution key from the edge beacon. Persisted to
   * cart_abandonments.session_id so the analytics funnel can match a started cart
   * back to the form view that produced it. Optional — older beacons / blocked
   * storage may omit it.
   */
  sessionId: z.string().min(1).max(128).optional(),
});

export type SaveCartInput = z.infer<typeof saveCartSchema>;
