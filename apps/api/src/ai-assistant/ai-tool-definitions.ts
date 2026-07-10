/**
 * Claude tool definitions for the AI Assistant.
 *
 * Category C — pre-built report tools (predictable, fast).
 * Category A — ad-hoc query tools (flexible list queries).
 *
 * Each tool definition follows the Anthropic tool_use schema.
 */

import type Anthropic from '@anthropic-ai/sdk';

type ToolDef = Anthropic.Tool;

// ─── Category C: Pre-built Report Tools ──────────────────────────────

const getOrderStatusCounts: ToolDef = {
  name: 'get_order_status_counts',
  description:
    'Get order counts grouped by status (UNPROCESSED, CS_ASSIGNED, CS_ENGAGED, CONFIRMED, AGENT_ASSIGNED, DISPATCHED, IN_TRANSIT, DELIVERED, REMITTED, DELETED). ' +
    'Accepts optional date range and branch filters.',
  input_schema: {
    type: 'object' as const,
    properties: {
      startDate: { type: 'string', description: 'Start date (YYYY-MM-DD). Defaults to start of current month.' },
      endDate: { type: 'string', description: 'End date (YYYY-MM-DD). Defaults to today.' },
      branchId: { type: 'string', description: 'Filter by branch ID (optional).' },
    },
    required: [],
  },
};

const getRevenueSummary: ToolDef = {
  name: 'get_revenue_summary',
  description:
    'Get a financial profit report: revenue, ad spend, commission, fulfillment cost, landed cost (FIFO COGS), true profit, margin, and order count. ' +
    'Uses materialized views when available for speed.',
  input_schema: {
    type: 'object' as const,
    properties: {
      startDate: { type: 'string', description: 'Start date (YYYY-MM-DD). Defaults to start of current month.' },
      endDate: { type: 'string', description: 'End date (YYYY-MM-DD). Defaults to today.' },
    },
    required: [],
  },
};

const getMarketingMetrics: ToolDef = {
  name: 'get_marketing_metrics',
  description:
    'Get marketing performance metrics: total ad spend, order count, CPA (cost per acquisition), ROAS (return on ad spend), paid orders, and pending orders. ' +
    'Can be filtered by media buyer, date range, and branch.',
  input_schema: {
    type: 'object' as const,
    properties: {
      mediaBuyerId: { type: 'string', description: 'Filter by specific media buyer ID (optional).' },
      period: { type: 'string', enum: ['this_month', 'all_time'], description: 'Period preset. Defaults to this_month.' },
      startDate: { type: 'string', description: 'Custom start date (YYYY-MM-DD). Overrides period.' },
      endDate: { type: 'string', description: 'Custom end date (YYYY-MM-DD). Overrides period.' },
      branchId: { type: 'string', description: 'Filter by branch ID (optional).' },
    },
    required: [],
  },
};

const getInventoryLevels: ToolDef = {
  name: 'get_inventory_levels',
  description:
    'Get current inventory stock levels. Returns stock count, reserved count, and totals per product/location. ' +
    'Supports filtering by product, location, and pagination.',
  input_schema: {
    type: 'object' as const,
    properties: {
      productId: { type: 'string', description: 'Filter by product ID (optional).' },
      locationId: { type: 'string', description: 'Filter by location ID (optional).' },
      page: { type: 'number', description: 'Page number (default 1).' },
      limit: { type: 'number', description: 'Items per page (default 20, max 50).' },
    },
    required: [],
  },
};

const getStaffList: ToolDef = {
  name: 'get_staff_list',
  description:
    'Get a list of staff members. Can filter by role, status, and search by name/email. ' +
    'Returns name, email, role, status, branch memberships, and supervisor flag.',
  input_schema: {
    type: 'object' as const,
    properties: {
      role: { type: 'string', description: 'Filter by role (e.g. CS_CLOSER, MEDIA_BUYER, FINANCE_OFFICER).' },
      status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'PROBATION'], description: 'Filter by status.' },
      search: { type: 'string', description: 'Search by name or email.' },
      page: { type: 'number', description: 'Page number (default 1).' },
      limit: { type: 'number', description: 'Items per page (default 20, max 50).' },
    },
    required: [],
  },
};

const getLogisticsHealth: ToolDef = {
  name: 'get_logistics_health',
  description:
    'Get logistics health dashboard: shrinkage alerts, stuck orders, transfer delays, and total escalation count.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

// ─── Category A: Ad-hoc Query Tools ──────────────────────────────────

const queryOrders: ToolDef = {
  name: 'query_orders',
  description:
    'Search and list orders with flexible filters. Returns order details including status, customer name (phone masked), amounts, assigned staff, products, and timestamps. ' +
    'Use this for ad-hoc order queries that the pre-built tools don\'t cover.',
  input_schema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string',
        enum: ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED', 'DELETED'],
        description: 'Filter by order status.',
      },
      assignedCsId: { type: 'string', description: 'Filter by assigned Sales closer ID.' },
      mediaBuyerId: { type: 'string', description: 'Filter by media buyer ID.' },
      startDate: { type: 'string', description: 'Filter orders created from this date (YYYY-MM-DD).' },
      endDate: { type: 'string', description: 'Filter orders created until this date (YYYY-MM-DD).' },
      search: { type: 'string', description: 'Search by customer name or order details.' },
      page: { type: 'number', description: 'Page number (default 1).' },
      limit: { type: 'number', description: 'Items per page (default 20, max 50).' },
    },
    required: [],
  },
};

const queryProducts: ToolDef = {
  name: 'query_products',
  description:
    'List products with optional filters. Returns product name, category, pricing, and status.',
  input_schema: {
    type: 'object' as const,
    properties: {
      search: { type: 'string', description: 'Search by product name.' },
      categoryId: { type: 'string', description: 'Filter by category ID.' },
      status: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'], description: 'Filter by status.' },
      page: { type: 'number', description: 'Page number (default 1).' },
      limit: { type: 'number', description: 'Items per page (default 20, max 50).' },
    },
    required: [],
  },
};

// ─── Tool Registry ───────────────────────────────────────────────────

export const AI_TOOLS: ToolDef[] = [
  // Category C
  getOrderStatusCounts,
  getRevenueSummary,
  getMarketingMetrics,
  getInventoryLevels,
  getStaffList,
  getLogisticsHealth,
  // Category A
  queryOrders,
  queryProducts,
];

/**
 * Permission code required per tool. The tool executor checks the user's
 * permissions before executing. SUPER_ADMIN / SUPPORT bypass all checks.
 */
export const TOOL_PERMISSION_MAP: Record<string, string> = {
  get_order_status_counts: 'orders.read',
  get_revenue_summary: 'finance.read',
  get_marketing_metrics: 'marketing.read',
  get_inventory_levels: 'inventory.read',
  get_staff_list: 'users.read',
  get_logistics_health: 'logistics.read',
  query_orders: 'orders.read',
  query_products: 'products.read',
};
