import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { jsonb } from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums';
import { permissionRequestTypeEnum, permissionRequestStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';

export const permissionRequests = pgTable('permission_requests', {
  id: uuidv7Pk(),
  type: permissionRequestTypeEnum('type').notNull(),
  status: permissionRequestStatusEnum('status').default('PENDING').notNull(),
  requesterId: text('requester_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  targetUserId: text('target_user_id').references(() => users.id, { onDelete: 'cascade' }),
  requestedRole: userRoleEnum('requested_role'),
  permissionCode: text('permission_code'),
  reason: text('reason').notNull(),
  approverId: text('approver_id').references(() => users.id),
  approvalReason: text('approval_reason'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  payload: jsonb('payload'),
  ...temporalColumns,
  ...timestampColumns,
});
