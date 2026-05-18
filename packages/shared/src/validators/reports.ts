import { z } from 'zod';

export const exportReportKeySchema = z.enum([
  'cs_orders',
  'cs_team',
  'marketing_orders',
  'marketing_team',
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
  cs_team: [
    'name',
    'role',
    'branches',
    'pending',
    'capacity',
    'assigned',
    'delivered',
    'confirmed',
    'cancelled',
    'callsMade',
    'confirmationRate',
    'deliveryRate',
    'avgCallSeconds',
    'lastActiveAt',
    'idle',
  ] as const,
  marketing_team: [
    'name',
    'role',
    'branches',
    'totalReceived',
    'totalSpend',
    'balance',
    'totalOrders',
    'deliveredOrders',
    'deliveredRevenue',
    'confirmationRate',
    'deliveryRate',
    'cpa',
    'trueRoas',
  ] as const,
  marketing_orders: [
    'id',
    'customer',
    'mediaBuyer',
    'assignedCs',
    'product',
    'campaign',
    'branch',
    'status',
    'amount',
    'created',
  ] as const,
  disbursements: ['id', 'sender', 'receiver', 'amount', 'status', 'receipt', 'date', 'verifiedAt'] as const,
  inventory: ['product', 'location', 'stock', 'reserved', 'available', 'status', 'updated'] as const,
  finance_invoices: ['reference', 'orderId', 'amount', 'status', 'dueDate'] as const,
} as const;

const reportColumnsSchema = z.object({
  cs_orders: z.array(z.enum(reportColumnsByKey.cs_orders)).min(1),
  cs_team: z.array(z.enum(reportColumnsByKey.cs_team)).min(1),
  marketing_orders: z.array(z.enum(reportColumnsByKey.marketing_orders)).min(1),
  marketing_team: z.array(z.enum(reportColumnsByKey.marketing_team)).min(1),
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
        minAmount: z.number().nonnegative().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('cs_team'),
    columns: reportColumnsSchema.shape.cs_team,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        // Date range filter scopes the leaderboard counts (assigned/delivered/confirmed)
        // to the same window the page shows. Workload + idle state are always live.
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
        minRate: z.number().nonnegative().optional(),
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
        assignedCsId: z.string().uuid().optional(),
        productId: z.string().uuid().optional(),
        campaignId: z.string().uuid().optional(),
        minAmount: z.number().nonnegative().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('marketing_team'),
    columns: reportColumnsSchema.shape.marketing_team,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
        role: z.enum(['MEDIA_BUYER', 'HEAD_OF_MARKETING']).optional(),
        minAmount: z.number().nonnegative().optional(),
        maxAmount: z.number().nonnegative().optional(),
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
        minAmount: z.number().nonnegative().optional(),
        maxAmount: z.number().nonnegative().optional(),
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
        status: z.string().optional(),
        maxAvailable: z.number().int().min(0).optional(),
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
        minAmount: z.number().nonnegative().optional(),
        maxAmount: z.number().nonnegative().optional(),
      })
      .optional(),
  }),
]);

export type ExportReportInput = z.infer<typeof exportReportSchema>;

