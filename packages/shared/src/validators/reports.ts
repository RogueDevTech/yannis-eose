import { z } from 'zod';

export const exportReportKeySchema = z.enum([
  'cs_orders',
  'marketing_orders',
  'disbursements',
  'inventory',
  'finance_invoices',
]);
export type ExportReportKey = z.infer<typeof exportReportKeySchema>;

export const exportDatePresetSchema = z.enum(['today', 'last_7_days', 'last_30_days', 'this_month', 'all_time', 'custom']);
export type ExportDatePreset = z.infer<typeof exportDatePresetSchema>;

export const exportDateRangeSchema = z.object({
  preset: exportDatePresetSchema.default('this_month'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type ExportDateRange = z.infer<typeof exportDateRangeSchema>;

export const reportColumnsByKey = {
  cs_orders: ['id', 'customer', 'assignedCs', 'phone', 'status', 'amount', 'created'] as const,
  marketing_orders: ['id', 'customer', 'mediaBuyer', 'status', 'amount', 'created'] as const,
  disbursements: ['id', 'sender', 'receiver', 'amount', 'status', 'receipt', 'date', 'verifiedAt'] as const,
  inventory: ['product', 'location', 'stock', 'reserved', 'available', 'status', 'updated'] as const,
  finance_invoices: ['reference', 'orderId', 'amount', 'status', 'dueDate'] as const,
} as const;

const reportColumnsSchema = z.object({
  cs_orders: z.array(z.enum(reportColumnsByKey.cs_orders)).min(1),
  marketing_orders: z.array(z.enum(reportColumnsByKey.marketing_orders)).min(1),
  disbursements: z.array(z.enum(reportColumnsByKey.disbursements)).min(1),
  inventory: z.array(z.enum(reportColumnsByKey.inventory)).min(1),
  finance_invoices: z.array(z.enum(reportColumnsByKey.finance_invoices)).min(1),
});

export const exportReportSchema = z.discriminatedUnion('reportKey', [
  z.object({
    reportKey: z.literal('cs_orders'),
    columns: reportColumnsSchema.shape.cs_orders,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
        search: z.string().optional(),
        assignedCsId: z.string().uuid().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('marketing_orders'),
    columns: reportColumnsSchema.shape.marketing_orders,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
        search: z.string().optional(),
        mediaBuyerId: z.string().uuid().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('disbursements'),
    columns: reportColumnsSchema.shape.disbursements,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
        receiverId: z.string().uuid().optional(),
        search: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('inventory'),
    columns: reportColumnsSchema.shape.inventory,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        productId: z.string().uuid().optional(),
        locationId: z.string().uuid().optional(),
        search: z.string().optional(),
        sort: z.enum(['lowestAvailable', 'highestAvailable']).optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('finance_invoices'),
    columns: reportColumnsSchema.shape.finance_invoices,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
      })
      .optional(),
  }),
]);

export type ExportReportInput = z.infer<typeof exportReportSchema>;

