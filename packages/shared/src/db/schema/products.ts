import { pgTable, text, numeric, integer } from 'drizzle-orm/pg-core';
import { recordStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';

// Table 2: products
export const products = pgTable('products', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  description: text('description'),
  sku: text('sku').notNull().unique(),
  baseSalePrice: numeric('base_sale_price', { precision: 12, scale: 2 }).notNull(),
  costPrice: numeric('cost_price', { precision: 12, scale: 2 }).notNull(),
  minThreshold: integer('min_threshold').default(0).notNull(),
  category: text('category'),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});
