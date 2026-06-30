import { uuid, pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums';
import { permissionRequestTypeEnum, permissionRequestStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';

export const permissionRequests = pgTable('permission_requests', {
  id: uuidv7Pk(),
  type: permissionRequestTypeEnum('type').notNull(),
  status: permissionRequestStatusEnum('status').default('PENDING').notNull(),
  requesterId: uuid('requester_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'cascade' }),
  requestedRole: userRoleEnum('requested_role'),
  permissionCode: text('permission_code'),
  reason: text('reason').notNull(),
  approverId: uuid('approver_id').references(() => users.id),
  approvalReason: text('approval_reason'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  /** Dual-approval: CS-side (HoCS/BranchAdmin) sign-off for DELIVERED_ORDER_DELETION */
  csApprovedBy: uuid('cs_approved_by').references(() => users.id),
  csApprovedAt: timestamp('cs_approved_at', { withTimezone: true }),
  csNote: text('cs_note'),
  /** Dual-approval: Logistics-side (HoL) sign-off for DELIVERED_ORDER_DELETION */
  logiApprovedBy: uuid('logi_approved_by').references(() => users.id),
  logiApprovedAt: timestamp('logi_approved_at', { withTimezone: true }),
  logiNote: text('logi_note'),
  payload: jsonb('payload'),
  ...temporalColumns,
  ...timestampColumns,
});
