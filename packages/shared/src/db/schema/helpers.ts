import { sql } from 'drizzle-orm';
import { text, timestamp } from 'drizzle-orm/pg-core';

/**
 * UUIDv7 primary key — timestamp-ordered for B-tree performance.
 * Uses gen_random_uuid() as fallback; actual UUIDv7 generation
 * will be handled by a Postgres extension or application layer.
 */
export const uuidv7Pk = () =>
  text('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .notNull();

/**
 * Temporal versioning + audit columns for system-versioned tables.
 * valid_from: when this row version became active
 * valid_to: when this row version was superseded (NULL = current)
 * modified_by: actor UUID stamped by the yannis_stamp_actor trigger
 */
export const temporalColumns = {
  validFrom: timestamp('valid_from', { withTimezone: true })
    .defaultNow()
    .notNull(),
  validTo: timestamp('valid_to', { withTimezone: true }),
  modifiedBy: text('modified_by'),
};

/**
 * Standard created_at / updated_at timestamps.
 */
export const timestampColumns = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
};
