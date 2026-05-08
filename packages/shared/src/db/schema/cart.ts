import { uuid, pgTable, text } from 'drizzle-orm/pg-core';
import { cartStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { campaigns } from './marketing';
import { products } from './products';
import { users } from './users';
import { orders } from './orders';

// Table: cart_abandonments — tracks carts that may convert to orders or be abandoned
export const cartAbandonments = pgTable('cart_abandonments', {
  id: uuidv7Pk(),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  mediaBuyerId: uuid('media_buyer_id').references(() => users.id),
  customerName: text('customer_name').notNull(),
  customerPhoneHash: text('customer_phone_hash').notNull(),
  /**
   * Raw customer phone for CS reveal/click-to-call on dropped-off carts
   * (CEO directive 2026-05-08). Set by the Edge Worker when the cart is
   * captured; never returned to the browser except via the audited
   * `cart.revealPhoneForAbandoned` endpoint. Pillar 2 still applies.
   */
  customerPhone: text('customer_phone'),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  offerLabel: text('offer_label'),
  status: cartStatusEnum('status').default('PENDING').notNull(),
  convertedOrderId: uuid('converted_order_id').references(() => orders.id),
  ...temporalColumns,
  ...timestampColumns,
});
