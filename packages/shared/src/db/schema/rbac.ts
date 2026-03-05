import { pgTable, text, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums';
import { uuidv7Pk, temporalColumns } from './helpers';
import { users } from './users';

export const permissions = pgTable('permissions', {
  id: uuidv7Pk(),
  code: text('code').notNull().unique(),
  resource: text('resource').notNull(),
  action: text('action').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  ...temporalColumns,
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    role: userRoleEnum('role').notNull(),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    ...temporalColumns,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.role, t.permissionId] }),
  }),
);

export const userPermissions = pgTable('user_permissions', {
  id: uuidv7Pk(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  permissionId: text('permission_id')
    .notNull()
    .references(() => permissions.id, { onDelete: 'cascade' }),
  granted: boolean('granted').notNull().default(true),
  grantedBy: text('granted_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  ...temporalColumns,
});
