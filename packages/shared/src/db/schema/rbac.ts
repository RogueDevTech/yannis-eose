import { uuid, pgTable, text, boolean, timestamp, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
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
    permissionId: uuid('permission_id')
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
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id')
    .notNull()
    .references(() => permissions.id, { onDelete: 'cascade' }),
  granted: boolean('granted').notNull().default(true),
  grantedBy: text('granted_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  ...temporalColumns,
});

export const roleTemplates = pgTable(
  'role_templates',
  {
    id: uuidv7Pk(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind').notNull().default('CUSTOM'),
    status: text('status').notNull().default('ACTIVE'),
    locked: boolean('locked').notNull().default(false),
    mappedRole: userRoleEnum('mapped_role'),
    ...timestampColumns,
    ...temporalColumns,
  },
  (t) => ({
    keyIdx: uniqueIndex('role_templates_key_unique').on(t.key),
  }),
);

export const roleTemplatePermissions = pgTable(
  'role_template_permissions',
  {
    roleTemplateId: uuid('role_template_id')
      .notNull()
      .references(() => roleTemplates.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    ...temporalColumns,
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleTemplateId, t.permissionId] }),
  }),
);
