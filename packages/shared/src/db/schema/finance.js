"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoices = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const enums_1 = require("./enums");
const helpers_1 = require("./helpers");
const orders_1 = require("./orders");
exports.invoices = (0, pg_core_1.pgTable)('invoices', {
    id: (0, helpers_1.uuidv7Pk)(),
    referenceNumber: (0, pg_core_1.serial)('reference_number').notNull().unique(),
    orderId: (0, pg_core_1.text)('order_id').references(() => orders_1.orders.id),
    recipientInfo: (0, pg_core_1.jsonb)('recipient_info'),
    lineItems: (0, pg_core_1.jsonb)('line_items'),
    taxRate: (0, pg_core_1.numeric)('tax_rate', { precision: 5, scale: 4 }),
    totalAmount: (0, pg_core_1.numeric)('total_amount', { precision: 12, scale: 2 }).notNull(),
    status: (0, enums_1.invoiceStatusEnum)('status').default('DRAFT').notNull(),
    dueDate: (0, pg_core_1.timestamp)('due_date', { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    ...helpers_1.temporalColumns,
});
//# sourceMappingURL=finance.js.map