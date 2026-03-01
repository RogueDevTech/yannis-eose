import { pgTable, text, jsonb } from 'drizzle-orm/pg-core';
import { recordStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';

// Table 4: logistics_providers
export const logisticsProviders = pgTable('logistics_providers', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  contactInfo: text('contact_info'),
  coverageArea: text('coverage_area'),
  rateCard: jsonb('rate_card'),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Table 5: logistics_locations
export const logisticsLocations = pgTable('logistics_locations', {
  id: uuidv7Pk(),
  providerId: text('provider_id')
    .notNull()
    .references(() => logisticsProviders.id),
  name: text('name').notNull(),
  address: text('address').notNull(),
  coordinates: text('coordinates'),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});
