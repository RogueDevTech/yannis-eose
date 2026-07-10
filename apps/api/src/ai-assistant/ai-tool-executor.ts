/**
 * AI Tool Executor — runs Claude's tool_use requests against real service
 * methods with role-based filtering applied BEFORE results are returned.
 *
 * Security model:
 * 1. Check user has the required permission for the data domain
 * 2. Always pass effectiveBranchIds for company/branch scoping
 * 3. Strip finance fields for non-finance users
 * 4. Mask customer phone numbers (Lead Fortress)
 */

import { TOOL_PERMISSION_MAP } from './ai-tool-definitions';
import { hasFinanceAccess } from '../common/utils/strip-finance-fields';
import type { OrdersService } from '../orders/orders.service';
import type { FinanceService } from '../finance/finance.service';
import type { MarketingService } from '../marketing/marketing.service';
import type { InventoryService } from '../inventory/inventory.service';
import type { LogisticsService } from '../logistics/logistics.service';
import type { UsersService } from '../users/users.service';
import type { ProductsService } from '../products/products.service';

export interface ToolExecutorUser {
  id: string;
  role: string;
  permissions?: string[];
}

export interface ToolExecutorContext {
  user: ToolExecutorUser;
  branchId: string | null;
  effectiveBranchIds: string[] | null;
  activeGroupId: string | null;
}

export interface ToolExecutorServices {
  ordersService: OrdersService;
  financeService: FinanceService;
  marketingService: MarketingService;
  inventoryService: InventoryService;
  logisticsService: LogisticsService;
  usersService: UsersService;
  productsService: ProductsService;
}

const ADMIN_BYPASS_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUPPORT']);
const MAX_RESULT_CHARS = 50_000;

function userHasPermission(user: ToolExecutorUser, code: string): boolean {
  if (ADMIN_BYPASS_ROLES.has(user.role)) return true;
  return (user.permissions ?? []).includes(code);
}

function maskPhones(data: unknown): unknown {
  if (data == null) return data;
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.map(maskPhones);
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (/phone/i.test(key) && typeof value === 'string') {
        result[key] = value.length > 4 ? '***' + value.slice(-4) : '****';
      } else {
        result[key] = maskPhones(value);
      }
    }
    return result;
  }
  return data;
}

function stripFinanceFromResult(data: unknown): unknown {
  if (data == null) return data;
  if (Array.isArray(data)) return data.map(stripFinanceFromResult);
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const financeKeys = new Set([
      'revenue', 'adSpend', 'commission', 'fulfillmentCost', 'operationalLoss',
      'landedCost', 'trueProfit', 'margin', 'deliveryFee', 'costPrice',
      'totalAmount', 'spend', 'cpa', 'roas',
    ]);
    for (const [key, value] of Object.entries(obj)) {
      if (financeKeys.has(key)) continue;
      result[key] = stripFinanceFromResult(value);
    }
    return result;
  }
  return data;
}

function truncateResult(result: string): string {
  if (result.length <= MAX_RESULT_CHARS) return result;
  return result.slice(0, MAX_RESULT_CHARS) + '\n... [result truncated]';
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  ctx: ToolExecutorContext,
  services: ToolExecutorServices,
): Promise<string> {
  // 1. Permission check
  const requiredPerm = TOOL_PERMISSION_MAP[toolName];
  if (requiredPerm && !userHasPermission(ctx.user, requiredPerm)) {
    return JSON.stringify({ error: `You do not have access to this data (requires ${requiredPerm}).` });
  }

  let result: unknown;

  try {
    switch (toolName) {
      // ─── Category C: Pre-built Reports ─────────────────
      case 'get_order_status_counts': {
        const startDate = (params.startDate as string) || monthStartStr();
        const endDate = (params.endDate as string) || todayStr();
        const branchId = (params.branchId as string) || ctx.branchId;
        result = await services.ordersService.getStatusCounts(
          undefined, // mediaBuyerId
          startDate,
          endDate,
          undefined, // assignedCsId
          undefined, // logisticsLocationId
          branchId,
          undefined, // statuses
          undefined, // supervisorScope
          'servicing', // branchScope
          ctx.effectiveBranchIds,
        );
        break;
      }

      case 'get_revenue_summary': {
        const startDate = (params.startDate as string) || monthStartStr();
        const endDate = (params.endDate as string) || todayStr();
        if (!userHasPermission(ctx.user, 'finance.costView') && !hasFinanceAccess(ctx.user)) {
          return JSON.stringify({ error: 'You do not have access to financial data.' });
        }
        result = await services.financeService.getFastProfitReport(
          startDate,
          endDate,
          ctx.effectiveBranchIds,
        );
        break;
      }

      case 'get_marketing_metrics': {
        const period = (params.period as 'this_month' | 'all_time') || 'this_month';
        const startDate = params.startDate as string | undefined;
        const endDate = params.endDate as string | undefined;
        const branchId = (params.branchId as string) || ctx.branchId;
        const mediaBuyerId = params.mediaBuyerId as string | undefined;
        result = await services.marketingService.getPerformanceMetrics(
          mediaBuyerId,
          period,
          startDate,
          endDate,
          branchId,
          undefined, // assignedCsId
          undefined, // supervisorScope
          ctx.effectiveBranchIds,
        );
        break;
      }

      case 'get_inventory_levels': {
        const page = Math.min(Math.max((params.page as number) || 1, 1), 100);
        const limit = Math.min(Math.max((params.limit as number) || 20, 1), 50);
        result = await services.inventoryService.listLevels(
          {
            productId: params.productId as string | undefined,
            locationId: params.locationId as string | undefined,
            page,
            limit,
            sortBy: 'updatedAt',
            sortOrder: 'desc',
          },
          ctx.activeGroupId,
        );
        break;
      }

      case 'get_staff_list': {
        const page = Math.min(Math.max((params.page as number) || 1, 1), 100);
        const limit = Math.min(Math.max((params.limit as number) || 20, 1), 50);
        result = await services.usersService.list(
          {
            search: params.search as string | undefined,
            role: params.role as string | undefined,
            status: (params.status as string | undefined) || 'ACTIVE',
            page,
            limit,
            sortBy: 'name',
            sortOrder: 'asc',
            includeBranchMemberships: true,
          } as any,
          ctx.user,
          ctx.branchId,
          ctx.effectiveBranchIds,
          ctx.activeGroupId,
        );
        break;
      }

      case 'get_logistics_health': {
        result = await services.logisticsService.getLogisticsHealthDashboard(
          ctx.effectiveBranchIds,
        );
        break;
      }

      // ─── Category A: Ad-hoc Queries ────────────────────
      case 'query_orders': {
        const page = Math.min(Math.max((params.page as number) || 1, 1), 100);
        const limit = Math.min(Math.max((params.limit as number) || 20, 1), 50);
        result = await services.ordersService.list(
          {
            status: params.status as any,
            assignedCsId: params.assignedCsId as string | undefined,
            mediaBuyerId: params.mediaBuyerId as string | undefined,
            startDate: params.startDate as string | undefined,
            endDate: params.endDate as string | undefined,
            search: params.search as string | undefined,
            page,
            limit,
            sortBy: 'createdAt',
            sortOrder: 'desc',
          } as any,
          ctx.branchId,
          {
            searchIncludeCustomerPhone: false,
            branchScope: 'servicing',
            effectiveBranchIds: ctx.effectiveBranchIds,
          },
        );
        break;
      }

      case 'query_products': {
        const page = Math.min(Math.max((params.page as number) || 1, 1), 100);
        const limit = Math.min(Math.max((params.limit as number) || 20, 1), 50);
        result = await services.productsService.list(
          {
            search: params.search as string | undefined,
            categoryId: params.categoryId as string | undefined,
            status: params.status as any,
            page,
            limit,
          } as any,
          ctx.user.id,
          ctx.user.role,
          ctx.activeGroupId,
        );
        break;
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: `Tool execution failed: ${err.message || 'Unknown error'}` });
  }

  // 2. Always mask phone numbers (Lead Fortress)
  result = maskPhones(result);

  // 3. Strip finance fields for non-finance users
  if (!hasFinanceAccess(ctx.user)) {
    result = stripFinanceFromResult(result);
  }

  return truncateResult(JSON.stringify(result, null, 2));
}
