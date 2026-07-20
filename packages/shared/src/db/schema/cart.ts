import { integer, jsonb, uuid, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
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
  /**
   * Progressive form-field capture (migration 0142). Edge Worker writes these
   * on the same debounced `cart.save` cycle as name+phone so a dropped cart
   * holds every value the customer typed. Hydrates the recovery modal so CS
   * doesn't re-type and preserves MB attribution when the cart converts.
   */
  customerEmail: text('customer_email'),
  customerAddress: text('customer_address'),
  deliveryAddress: text('delivery_address'),
  deliveryState: text('delivery_state'),
  deliveryNotes: text('delivery_notes'),
  customerGender: text('customer_gender'),
  preferredDeliveryDate: text('preferred_delivery_date'),
  paymentMethod: text('payment_method'),
  quantity: integer('quantity'),
  /** Form-builder custom fields — keys/values defined by the campaign's form schema. */
  customFieldValues: jsonb('custom_field_values'),
  /** Why the auto-pull cron skipped this cart. NULL = not yet evaluated or successfully pulled. */
  skipReason: text('skip_reason'),
  /** FK to the duplicate order that blocked recovery. */
  duplicateOfOrderId: uuid('duplicate_of_order_id'),
  /** FK to the duplicate cart order that blocked recovery. */
  duplicateOfCartOrderId: uuid('duplicate_of_cart_order_id'),
  /** FK to the duplicate follow-up order that blocked recovery. */
  duplicateOfFollowUpOrderId: uuid('duplicate_of_follow_up_order_id'),
  /** When the skip reason was tagged by the cron. */
  skipTaggedAt: timestamp('skip_tagged_at', { withTimezone: true }),
  ...temporalColumns,
  ...timestampColumns,
});
