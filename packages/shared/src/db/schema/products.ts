import { uuid, pgTable, text, numeric, jsonb } from 'drizzle-orm/pg-core';
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
  smsSenderId: uuid('sms_sender_id'),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Products
export const products = pgTable('products', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  description: text('description'),
  /** Catalog gallery (public-safe URLs); offer tiers store images on `offer_templates.image_urls`. */
  galleryImageUrls: jsonb('gallery_image_urls').notNull().default([]),
  offers: jsonb('offers').notNull().default([]),
  baseSalePrice: numeric('base_sale_price', { precision: 12, scale: 2 }).notNull(),
  costPrice: numeric('cost_price', { precision: 12, scale: 2 }).notNull(),
  category: text('category'),
  categoryId: uuid('category_id').references(() => productCategories.id),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});
