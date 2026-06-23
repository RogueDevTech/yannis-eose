import { uuid, pgTable, text, numeric, jsonb, integer, index } from 'drizzle-orm/pg-core';
import { recordStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { branchGroups } from './branch-groups';

// Product categories — brand info for invoices, SMS, WhatsApp
export const productCategories = pgTable('product_categories', {
  id: uuidv7Pk(),
  /** Company-group isolation. NULL = legacy/global (backfilled to default group). */
  groupId: uuid('group_id').references(() => branchGroups.id),
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
  /** Branch group ("company") this product belongs to. CEO directive 2026-06-10. */
  groupId: uuid('group_id').references(() => branchGroups.id),
  name: text('name').notNull(),
  description: text('description'),
  /** Catalog gallery (public-safe URLs); offer tiers store images on `offer_templates.image_urls`. */
  galleryImageUrls: jsonb('gallery_image_urls').notNull().default([]),
  offers: jsonb('offers').notNull().default([]),
  baseSalePrice: numeric('base_sale_price', { precision: 12, scale: 2 }).notNull(),
  /**
   * Optional reference cost — NOT used for COGS/profit (those come from FIFO
   * landed cost on shipment lines). Nullable as of migration 0223; the product
   * form no longer collects it.
   */
  costPrice: numeric('cost_price', { precision: 12, scale: 2 }),
  category: text('category'),
  categoryId: uuid('category_id').references(() => productCategories.id),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

/**
 * Bundle components — a product that is composed of other products.
 * When a bundle is ordered, inventory is checked/reserved/deducted
 * from the component products, not the bundle itself.
 *
 * A product IS a bundle if it has rows in this table.
 * Bundles are strictly one level deep — a component cannot itself be a bundle.
 */
export const productBundleComponents = pgTable(
  'product_bundle_components',
  {
    id: uuidv7Pk(),
    bundleProductId: uuid('bundle_product_id')
      .notNull()
      .references(() => products.id),
    componentProductId: uuid('component_product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull(),
    ...temporalColumns,
    ...timestampColumns,
  },
  (table) => ({
    bundleIdx: index('idx_bundle_components_bundle').on(table.bundleProductId),
    componentIdx: index('idx_bundle_components_component').on(table.componentProductId),
  }),
);
