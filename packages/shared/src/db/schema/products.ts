import { pgTable, text, numeric, jsonb } from 'drizzle-orm/pg-core';
import { recordStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';

// Product categories — brand info for invoices, SMS, WhatsApp
export const productCategories = pgTable('product_categories', {
  id: uuidv7Pk(),
  name: text('name').notNull().unique(),
  brandName: text('brand_name').notNull(),
  brandPhone: text('brand_phone'),
  brandEmail: text('brand_email'),
  brandWhatsapp: text('brand_whatsapp'),
  smsSenderId: text('sms_sender_id'),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Products
export const products = pgTable('products', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  description: text('description'),
  offers: jsonb('offers').notNull().default([]),
  baseSalePrice: numeric('base_sale_price', { precision: 12, scale: 2 }).notNull(),
  costPrice: numeric('cost_price', { precision: 12, scale: 2 }).notNull(),
  category: text('category'),
  categoryId: text('category_id').references(() => productCategories.id),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});
