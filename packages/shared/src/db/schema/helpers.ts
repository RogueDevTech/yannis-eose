import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * UUIDv7 primary key — timestamp-ordered for B-tree performance.
 *
 * Generated app-side at insert time with the `uuidv7` package (RFC 9562).
 * UUIDv7's first 48 bits are the Unix millisecond timestamp, so rows land
 * at the end of the B-tree in near-insertion-order — no random page splits,
 * better cache locality, and you can do range scans like
 *   WHERE id >= '018cd000-0000-7000-8000-000000000000'
 * to find "all rows created after X" without touching created_at.
 *
 * Column type is currently `text` (36-char UUID string). A future migration
 * will swap to native `uuid` for 16-byte storage + faster B-tree compares;
 * v7 values we generate now will carry over unchanged and retain ordering.
 *
 * If you need to override at insert time (migrations, seeds), just pass an
 * explicit `id` — the `$defaultFn` only fires when the field is omitted.
 */
export const uuidv7Pk = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7())
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
