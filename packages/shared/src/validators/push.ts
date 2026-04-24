import { z } from 'zod';

// ============================================
// Save Push Subscription
// ============================================

export const pushInstallModeSchema = z.enum(['STANDALONE', 'BROWSER', 'UNKNOWN']);
export type PushInstallMode = z.infer<typeof pushInstallModeSchema>;

export const savePushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  auth: z.string().min(1),
  p256dh: z.string().min(1),
  userAgent: z.string().optional(),
  /**
   * Whether the client is running as an installed PWA (home-screen icon) or in a regular
   * browser tab. Optional for back-compat with older clients — treated as UNKNOWN when omitted.
   */
  installMode: pushInstallModeSchema.optional(),
});

export type SavePushSubscriptionInput = z.infer<typeof savePushSubscriptionSchema>;

export const removePushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
});

export type RemovePushSubscriptionInput = z.infer<typeof removePushSubscriptionSchema>;

export const updatePushInstallModeSchema = z.object({
  endpoint: z.string().url(),
  installMode: pushInstallModeSchema,
});

export type UpdatePushInstallModeInput = z.infer<typeof updatePushInstallModeSchema>;

// ============================================
// Broadcast Push
// ============================================

export const broadcastPushSchema = z
  .object({
    targetType: z.enum(['ALL', 'ROLE', 'USER']),
    targetRole: z.string().optional(),
    targetUserId: z.string().optional(),
    title: z.string().min(1).max(80),
    body: z.string().min(1).max(120),
  })
  .refine(
    (d) => {
      if (d.targetType === 'ROLE') return !!d.targetRole;
      if (d.targetType === 'USER') return !!d.targetUserId;
      return true;
    },
    { message: 'targetRole or targetUserId required for this target type' },
  );

export type BroadcastPushInput = z.infer<typeof broadcastPushSchema>;

// ============================================
// Get Push Delivery Log
// ============================================

export const getPushDeliveryLogSchema = z.object({
  status: z.enum(['SENT', 'FAILED', 'SHOWN', 'CLICKED']).optional(),
  triggerType: z.enum(['MIRROR', 'BROADCAST', 'AUTOMATION']).optional(),
  userId: z.string().optional(),
  broadcastId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});

export type GetPushDeliveryLogInput = z.infer<typeof getPushDeliveryLogSchema>;

// ============================================
// Resend Push
// ============================================

export const resendPushSchema = z.object({ logId: z.string() });
export type ResendPushInput = z.infer<typeof resendPushSchema>;

// ============================================
// Bulk Resend Push
// ============================================

export const bulkResendPushSchema = z.object({
  logIds: z.array(z.string()).min(1).max(200),
});
export type BulkResendPushInput = z.infer<typeof bulkResendPushSchema>;

// ============================================
// Push Acknowledgement (shown / clicked)
// ============================================

export const pushAckSchema = z.object({
  logId: z.string(),
  event: z.enum(['shown', 'clicked']),
});
export type PushAckInput = z.infer<typeof pushAckSchema>;

// ============================================
// Create Automation Rule
// ============================================

const automationRuleBaseSchema = z.object({
  name: z.string().min(1).max(100),
  triggerType: z.enum(['CRON', 'EVENT']),
  cronExpr: z.string().optional(),
  eventKey: z.string().optional(),
  targetType: z.enum(['ALL', 'ROLE', 'USER']),
  targetRole: z.string().optional(),
  targetUserId: z.string().optional(),
  titleTemplate: z.string().min(1).max(80),
  bodyTemplate: z.string().min(1).max(120),
  isActive: z.boolean().default(true),
});

export const createAutomationRuleSchema = automationRuleBaseSchema.refine(
  (d) => {
    if (d.triggerType === 'CRON') return !!d.cronExpr;
    if (d.triggerType === 'EVENT') return !!d.eventKey;
    return true;
  },
  { message: 'cronExpr required for CRON rules, eventKey required for EVENT rules' },
);

export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;

// ============================================
// Update Automation Rule
// ============================================

export const updateAutomationRuleSchema = automationRuleBaseSchema
  .partial()
  .extend({ id: z.string() });

export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleSchema>;

// ============================================
// Toggle Automation Rule (active/inactive)
// ============================================

export const toggleAutomationRuleSchema = z.object({
  id: z.string(),
  isActive: z.boolean(),
});
export type ToggleAutomationRuleInput = z.infer<typeof toggleAutomationRuleSchema>;
