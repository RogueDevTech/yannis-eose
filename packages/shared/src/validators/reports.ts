import { z } from 'zod';

export const exportReportKeySchema = z.enum([
  'cs_orders',
  'cs_team',
  'marketing_orders',
  'marketing_team',
  'cross_funnel',
  'disbursements',
  'inventory',
  'finance_invoices',
  'logistics_locations',
  'logistics_partners',
  'cart_orders',
  'follow_up_orders',
  'delivery_remittances',
  'payroll',
  'funding_requests',
  'users',
  'expenses',
  'products',
  'shipments',
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
  cs_orders: ['id', 'customer', 'assignedCs', 'phone', 'status', 'amount', 'product', 'quantity', 'address', 'created'] as const,
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
  cross_funnel: [
    'customerName',
    'duplicateType',
    'mediaBuyer',
    'originalMediaBuyer',
    'product',
    'campaign',
    'originalCampaign',
    'originalOrderId',
    'originalOrderStatus',
    'originalOrderAmount',
    'attemptedAt',
    'originalOrderCreatedAt',
  ] as const,
  disbursements: ['id', 'sender', 'receiver', 'amount', 'status', 'receipt', 'date', 'verifiedAt'] as const,
  inventory: ['product', 'location', 'stock', 'reserved', 'available', 'status', 'updated'] as const,
  finance_invoices: ['reference', 'orderId', 'amount', 'status', 'dueDate'] as const,
  logistics_locations: [
    'locationName',
    'providerName',
    'contactInfo',
    'address',
    'whatsappGroupLink',
    'coverageArea',
    'status',
    'totalAssigned',
    'delivered',
    'inTransit',
    'dispatched',
    'returned',
    'deliveryRate',
    'delinquencyRate',
    'remittedAmount',
    'pendingRemittanceAmount',
    'unitsDelivered',
    'availableStock',
    'reservedStock',
    'stockReceived',
    'stockSold',
    'stockTransferredOut',
    'stockAdjusted',
  ] as const,
  logistics_partners: [
    'providerName',
    'contactInfo',
    'coverageArea',
    'status',
    'locations',
    'totalAssigned',
    'delivered',
    'inTransit',
    'dispatched',
    'returned',
    'deliveryRate',
    'delinquencyRate',
    'remittedAmount',
    'pendingRemittanceAmount',
    'unitsDelivered',
    'availableStock',
    'reservedStock',
    'stockReceived',
    'stockSold',
    'stockTransferredOut',
    'stockAdjusted',
  ] as const,
  cart_orders: [
    'id',
    'orderNumber',
    'customer',
    'phone',
    'status',
    'amount',
    'product',
    'assignedCs',
    'mediaBuyer',
    'campaign',
    'created',
  ] as const,
  follow_up_orders: [
    'id',
    'orderNumber',
    'customer',
    'status',
    'amount',
    'product',
    'assignedCs',
    'mediaBuyer',
    'campaign',
    'source',
    'created',
    'deliveredAt',
  ] as const,
  delivery_remittances: [
    'id',
    'locationName',
    'providerName',
    'status',
    'orderCount',
    'orderAmount',
    'sentBy',
    'sentAt',
    'created',
  ] as const,
  payroll: [
    'staffName',
    'role',
    'periodStart',
    'periodEnd',
    'baseSalary',
    'performanceBonus',
    'addOns',
    'deductions',
    'totalPayout',
    'status',
    'created',
  ] as const,
  funding_requests: [
    'id',
    'requester',
    'targetUser',
    'amount',
    'reason',
    'status',
    'balanceAtRequest',
    'created',
    'resolvedAt',
  ] as const,
  users: [
    'name',
    'email',
    'role',
    'status',
    'branches',
    'capacity',
    'isSupervisor',
    'created',
  ] as const,
  expenses: [
    'id',
    'description',
    'amount',
    'status',
    'submittedBy',
    'submittedAt',
    'approvedBy',
    'approvedAt',
    'created',
  ] as const,
  products: [
    'name',
    'category',
    'baseSalePrice',
    'costPrice',
    'totalStock',
    'status',
    'created',
  ] as const,
  shipments: [
    'reference',
    'label',
    'status',
    'destination',
    'supplier',
    'lineCount',
    'totalExpected',
    'totalReceived',
    'landingCost',
    'expectedArrival',
    'created',
  ] as const,
} as const;

const reportColumnsSchema = z.object({
  cs_orders: z.array(z.enum(reportColumnsByKey.cs_orders)).min(1),
  cs_team: z.array(z.enum(reportColumnsByKey.cs_team)).min(1),
  marketing_orders: z.array(z.enum(reportColumnsByKey.marketing_orders)).min(1),
  marketing_team: z.array(z.enum(reportColumnsByKey.marketing_team)).min(1),
  cross_funnel: z.array(z.enum(reportColumnsByKey.cross_funnel)).min(1),
  disbursements: z.array(z.enum(reportColumnsByKey.disbursements)).min(1),
  inventory: z.array(z.enum(reportColumnsByKey.inventory)).min(1),
  finance_invoices: z.array(z.enum(reportColumnsByKey.finance_invoices)).min(1),
  logistics_locations: z.array(z.enum(reportColumnsByKey.logistics_locations)).min(1),
  logistics_partners: z.array(z.enum(reportColumnsByKey.logistics_partners)).min(1),
  cart_orders: z.array(z.enum(reportColumnsByKey.cart_orders)).min(1),
  follow_up_orders: z.array(z.enum(reportColumnsByKey.follow_up_orders)).min(1),
  delivery_remittances: z.array(z.enum(reportColumnsByKey.delivery_remittances)).min(1),
  payroll: z.array(z.enum(reportColumnsByKey.payroll)).min(1),
  funding_requests: z.array(z.enum(reportColumnsByKey.funding_requests)).min(1),
  users: z.array(z.enum(reportColumnsByKey.users)).min(1),
  expenses: z.array(z.enum(reportColumnsByKey.expenses)).min(1),
  products: z.array(z.enum(reportColumnsByKey.products)).min(1),
  shipments: z.array(z.enum(reportColumnsByKey.shipments)).min(1),
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
    reportKey: z.literal('cross_funnel'),
    columns: reportColumnsSchema.shape.cross_funnel,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
        productId: z.string().uuid().optional(),
        campaignId: z.string().uuid().optional(),
        mediaBuyerId: z.string().uuid().optional(),
        search: z.string().optional(),
        duplicateType: z.string().optional(),
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
  z.object({
    reportKey: z.literal('logistics_locations'),
    columns: reportColumnsSchema.shape.logistics_locations,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        providerId: z.string().uuid().optional(),
        status: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('logistics_partners'),
    columns: reportColumnsSchema.shape.logistics_partners,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        providerId: z.string().uuid().optional(),
        status: z.string().optional(),
        productId: z.string().uuid().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('cart_orders'),
    columns: reportColumnsSchema.shape.cart_orders,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
        search: z.string().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('follow_up_orders'),
    columns: reportColumnsSchema.shape.follow_up_orders,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
        search: z.string().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('delivery_remittances'),
    columns: reportColumnsSchema.shape.delivery_remittances,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('payroll'),
    columns: reportColumnsSchema.shape.payroll,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('funding_requests'),
    columns: reportColumnsSchema.shape.funding_requests,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('users'),
    columns: reportColumnsSchema.shape.users,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        role: z.string().optional(),
        status: z.string().optional(),
        search: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('expenses'),
    columns: reportColumnsSchema.shape.expenses,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('products'),
    columns: reportColumnsSchema.shape.products,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
        search: z.string().optional(),
        categoryId: z.string().uuid().optional(),
      })
      .optional(),
  }),
  z.object({
    reportKey: z.literal('shipments'),
    columns: reportColumnsSchema.shape.shipments,
    dateRange: exportDateRangeSchema.optional(),
    filters: z
      .object({
        status: z.string().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        periodAllTime: z.boolean().optional(),
      })
      .optional(),
  }),
]);

export type ExportReportInput = z.infer<typeof exportReportSchema>;

