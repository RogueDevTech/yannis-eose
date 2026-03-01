import { pgTable, text, integer } from 'drizzle-orm/pg-core';
import { userRoleEnum, recordStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';

// Table 1: users
export const users = pgTable('users', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull(),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  capacity: integer('capacity').default(10).notNull(),
  // Links TPL_MANAGER and TPL_RIDER to their logistics location.
  // NULL for non-logistics roles.
  logisticsLocationId: text('logistics_location_id'),
  ...temporalColumns,
  ...timestampColumns,
});
