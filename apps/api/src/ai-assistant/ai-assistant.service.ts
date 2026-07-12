import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, desc, asc, and, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { randomUUID } from 'crypto';
import { DRIZZLE } from '../database/database.module';
import { encryptApiKey, decryptApiKey } from '../common/utils/encryption';
import { AI_TOOLS } from './ai-tool-definitions';
import { executeTool, type ToolExecutorContext, type ToolExecutorServices, type ToolExecutorUser } from './ai-tool-executor';

// ─── System Prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Yannis EOSE AI Assistant, a helpful tool built into an ERP/sales platform. You help users understand their business data, generate reports, and answer questions about how the app works.

## Your Capabilities
- Query order data (status counts, filters, lists)
- Pull financial reports (revenue, profit, margins, COGS)
- Check marketing metrics (ad spend, CPA, ROAS, media buyer performance)
- View inventory levels across products and locations
- List staff members by role, status, or search
- Check logistics health (stuck orders, transfer delays, shrinkage)
- Query the product catalog
- Answer questions about how the app works (order lifecycle, roles, features)

## Order Lifecycle
UNPROCESSED > CS_ASSIGNED > CS_ENGAGED > CONFIRMED > AGENT_ASSIGNED > DISPATCHED > IN_TRANSIT > DELIVERED > REMITTED
No state skipping. DELETED replaces the old CANCELLED status.

## Key Metrics and Formulas
When the user asks about rates, percentages, or metrics, use these exact formulas:

- **CR (Confirmation Rate)** = orders at CONFIRMED or beyond (CONFIRMED + AGENT_ASSIGNED + DISPATCHED + IN_TRANSIT + DELIVERED + REMITTED) / total orders (excluding DELETED). This measures how many orders the Sales team successfully confirms.
- **DR (Delivery Rate)** = orders at DELIVERED or REMITTED / orders at CONFIRMED or beyond. This measures how many confirmed orders actually get delivered.
- **CPA (Cost Per Acquisition)** = total ad spend / number of delivered orders. Lower is better. This tells you how much marketing spend it costs to get one delivered order.
- **ROAS (Return on Ad Spend)** = delivered revenue / total ad spend. Higher is better. A ROAS of 2x means every 1 spent on ads generates 2 in revenue.
- **True Profit** = revenue - (landed cost + delivery fees + ad spend + commission + fulfillment cost + operational losses). This is the real bottom line after ALL costs.
- **Margin** = true profit / revenue * 100. Above 20% is healthy (green), 0-20% is cautious (yellow), below 0% is a loss (red).

When explaining a metric, always:
1. Use the tool to fetch the actual current numbers
2. Show the calculation with real values (e.g. "190 confirmed / 500 total = 38% CR")
3. Explain what is driving the number up or down
4. Suggest what could improve it if the user asks

## Key Roles
- SUPER_ADMIN / ADMIN: Full access
- SUPPORT: Read-only admin access
- HEAD_OF_MARKETING / MEDIA_BUYER: Marketing funnel
- HEAD_OF_CS / CS_CLOSER: Sales/confirmation funnel
- HEAD_OF_LOGISTICS / STOCK_MANAGER / TPL_MANAGER / TPL_RIDER: Logistics chain
- FINANCE_OFFICER: Financial operations
- HR_MANAGER: Staff management
- BRANCH_ADMIN: Branch-level administration

## Formatting Rules
- Use markdown for formatting. Use tables for tabular data.
- Be concise and direct. Lead with the answer.
- When showing financial data, format numbers with commas and the Naira sign where appropriate.
- Format responses so they are easy to copy and share. Use clear headings, numbered lists, and clean tables.
- When the user asks you to edit, revise, or rewrite something, return the full edited version ready to copy, not a diff or explanation of changes.
- When presenting summaries or reports, structure them with clear sections so the user can copy the entire response or individual sections.

## Rules
- Never fabricate data. If a tool returns empty results, say so clearly.
- Never mention internal implementation details, tool names, system architecture, or URL paths (like /admin/marketing/funding). Refer to pages by their friendly name (e.g. "the Marketing Funding page") unless the user specifically asks for the URL.
- If the user asks something you can't answer with the available tools, say so and suggest what they could check manually.
- If a tool returns an error saying the user lacks permission, explain that they don't have access to that specific data and suggest they contact their admin.`;

// ─── Page Context Map ────────────────────────────────────────────────
// Maps known routes to descriptions so the AI understands what the user is looking at.

const PAGE_CONTEXT_MAP: Record<string, string> = {
  // ── Dashboard ──
  '/admin': `Admin Dashboard. SuperAdmin/Admin see CEO-level metrics (revenue, profit, ROAS, delivery stats, team performance). Other roles see their role-specific order funnel.`,

  '/admin/ceo': `CEO Executive Overview. Revenue, True Profit (revenue minus all costs), Net Margin (trueProfit/revenue×100, >=20% green, 0-20% yellow, <0% red), Total Costs. Cost breakdown: Landed COGS, Delivery Fees, Ad Spend, Commission, Fulfillment Cost, Operational Loss. Marketing: Total Spend, CPA (adSpend/deliveredOrders), ROAS (deliveredRevenue/adSpend). CS Team: Agent Count, Pending Orders, Utilization (todayCloses/capacity×100). Payroll: Total Paid, Total Pending, Staff Count. Branch-level breakdowns.`,

  // ── Marketing ──
  '/admin/marketing/overview': `Marketing Live Activities. Metrics: Ad Spend, Total Orders, Delivered (DELIVERED+REMITTED), Confirmed (CONFIRMED+AGENT_ASSIGNED+DISPATCHED+IN_TRANSIT+DELIVERED+REMITTED), Unconfirmed (total minus confirmed), Avg CPA, DR (delivered/total×100), CR (confirmed/total×100), True ROAS (deliveredRevenue/totalSpend), Delivered Revenue, Cart Abandonment.`,

  '/admin/marketing/team': `Marketing Team Analysis with per-media-buyer leaderboard. Metrics: Media Buyers (count), Total Orders, Ad Spend, CPA (adSpend/deliveredOrders), ROAS (deliveredRevenue/adSpend), Confirmed (CONFIRMED or beyond), Delivered (DELIVERED+REMITTED), CR (confirmed/totalOrders×100), DR (delivered/totalOrders×100, denominator is total orders NOT confirmed).`,

  '/admin/marketing/orders': `Marketing Orders list. Status tabs across lifecycle. Same stat strip as Marketing Overview plus: Offline Count, Abandoned Cart Count, Duplicate Count. Supervisors see dual strips: Team Performance and My Performance.`,

  '/admin/marketing/expenses': `Ad Spend / Expenses page. Media buyers log daily advertising costs, grouped by date and media buyer in accordion view. Columns: platform, ad URL, amount.`,

  '/admin/marketing/funding': `Marketing Funding hub. Two sections: Received (incoming funds) and Distributing (outgoing). Each has transfers and requests views. Metrics: incoming/outgoing/balance summaries, status counts (SENT/COMPLETED/DISPUTED for transfers; PENDING/APPROVED/REJECTED for requests).`,

  '/admin/marketing/funding/ledger': `Funding Ledger. Double-entry ledger for a selected media buyer showing all fund movements by entry type. Metrics: total credits, total debits, closing balance.`,

  '/admin/marketing/funding/mb-transfers': `MB Transfers. Fund transfers between media buyers with approval workflow. Metrics: transfer status distribution, directional flow (sent/received).`,

  '/admin/marketing/forms': `Marketing Forms. Lead capture form management with create/edit/builder. Shows form name, status, campaign, submissions count.`,

  '/admin/marketing/cross-funnel': `Cross-Funnel Attempts. Tracks same customer+product submissions via different media buyers within 24h. Metrics: total attempts, unique customers, per-product breakdown, same-MB vs cross-funnel splits.`,

  '/admin/marketing/leaderboard': `Marketing Leaderboard. Ranks media buyers by performance metrics in the selected period.`,

  '/admin/marketing/offers': `Offers management. Product offers/bundles with pricing. Two tabs: Products and Offers. Metrics: total products, active count, unique categories, total offers.`,

  // ── Sales / CS ──
  '/admin/sales/queue': `Sales Live Activities (Queue). Real-time agent workload dashboard. Shows: agent workloads (todayCloses, capacity, pendingCount, lastAction), status pipeline counts, unassigned queue total, active engagements total, cart activity. Tabs: Unassigned, Active Engagements, Pending Carts, Abandoned Carts, Callbacks, Duplicates, Claim Queue, Inactive Agents. Utilization = todayCloses/capacity×100.`,

  '/admin/sales/orders': `Sales Orders (main CS funnel). Status tabs: UNPROCESSED, CS_ASSIGNED, CS_ENGAGED, CONFIRMED, AGENT_ASSIGNED, DISPATCHED, IN_TRANSIT, DELIVERED, REMITTED. Schedule heat calendar (callback due, delivery on day, delivery overdue). For CS_CLOSER: personal workload (pending, today closes, capacity, utilization %).`,

  '/admin/sales/team': `CS Team Analysis. Metrics: Closers (count), Total Orders (engaged in period), Offline (manually created), Backlog/Unworked (engaged minus confirmed), Confirmed (CONFIRMED or beyond), Delivered (DELIVERED+REMITTED), Confirm Rate (confirmed/engaged×100), Delivery Rate (delivered/engaged×100, denominator is total engaged NOT confirmed), Calls Made, Avg Call duration. Per-closer leaderboard with same metrics.`,

  '/admin/sales/leaderboard': `Sales Leaderboard. Ranks closers by delivery rate in the selected period. Filters: this month, all-time, custom date range.`,

  '/admin/sales/cart-orders': `Cart Orders. Orders recovered from abandoned carts. Status counts per lifecycle stage. Separate pipeline from main orders.`,

  '/admin/sales/delivered-follow-up': `Delivered Follow-Up Orders. Re-engagement orders for previously delivered customers. Same status tabs and metrics as main Sales Orders but filtered to delivered follow-up source.`,

  '/admin/sales/offline-orders': `Offline Orders. Manually created orders by CS. Same status tabs as main Sales Orders but filtered to offline source. Category filter: website_order or referrals.`,

  '/admin/sales/follow-up': `Follow-Up Orders. Orders pulled by follow-up re-engagement rules. Status counts (DELETED, CS_ASSIGNED, CS_ENGAGED, CONFIRMED, AGENT_ASSIGNED, DISPATCHED, IN_TRANSIT, DELIVERED, REMITTED, ABANDONED_CART). Views: Orders list, Batches, Create follow-up.`,

  '/admin/sales/message-templates': `Message Templates. WhatsApp/SMS templates used by CS closers for customer communication.`,

  // ── Inventory ──
  '/admin/inventory': `Inventory page. Metrics: Total Stock (available+reserved), Reserved (committed not delivered), Available (total minus reserved), Locations count. Low stock alerts when below threshold. Filterable by product, location.`,

  '/admin/inventory/shipments': `Inbound Shipments. Receiving new stock with FIFO cost tracking. Each shipment has products, quantities, unit costs, and landed cost calculation.`,

  '/admin/inventory/transfers': `Stock Transfers. Moving inventory between locations. Status: PENDING, APPROVED, RECEIVED, CANCELLED. Shows source/destination, products, quantities.`,

  '/admin/inventory/warehouses': `Warehouses. Company-owned warehouse management. Metrics: active warehouse count, warehouses with stock, dispatch-locked count, total/reserved/available units, SKU count.`,

  // ── Logistics ──
  '/admin/logistics/overview': `Logistics Overview. Redirects to partners page.`,

  '/admin/logistics/orders': `Logistics Orders. Confirmed and in-flight orders with allocation, dispatch, and delivery workflow. Status tabs: CONFIRMED, AGENT_ASSIGNED, DISPATCHED, IN_TRANSIT, DELIVERED, PARTIALLY_DELIVERED, RETURNED, RESTOCKED, WRITTEN_OFF, REMITTED. Overdue delivery count. Bulk allocation and dispatch actions.`,

  '/admin/logistics/partners': `Logistics Partners. Third-party logistics providers and warehouse locations. Metrics: total providers, total locations, low-stock threshold. Import features for providers and locations.`,

  '/admin/logistics/team': `Logistics Team. Per-provider performance analysis. Metrics: total assigned orders, delivered orders, units delivered, delivery rate, delinquency rate, returned orders, location count. Sortable by all metrics. Date and product filters.`,

  '/admin/logistics/transfers': `Logistics Transfers. Stock transfers between partner locations with status tracking.`,

  '/admin/logistics/remittances': `Logistics Remittances. Cash remittance verification. Metrics: Awaiting/Pending/Received/Disputed amounts and counts, Total Remitted. Status filter, location filter, sender filter.`,

  // ── Finance ──
  '/admin/finance': `Finance Overview. Revenue (DELIVERED+REMITTED), COGS (FIFO landed cost), Gross Profit, Ad Spend, Commission, Delivery Fees, Operational Loss, True Profit (revenue minus ALL costs), Margin (trueProfit/revenue×100). Also: Awaiting Cash, Pending/Disputed Remittance amounts, Payroll Pending.`,
  '/admin/finance/overview': `Finance Overview (same as /admin/finance).`,

  '/admin/finance/delivery-remittances': `Cash Remittances. Manages remittance batches. Metrics: Awaiting Amount/Count, Pending Amount/Count, Received Amount/Count, Disputed Amount/Count, Total Remitted. Location, sender, status filters.`,

  '/admin/finance/profit-loss': `Profit & Loss statement. Metrics: Total Income, Total Expense, Net Profit. Income and expense line items. Consolidated vs branch view toggle.`,

  '/admin/finance/balance-sheet': `Balance Sheet. Point-in-time snapshot. Metrics: Total Assets, Total Liabilities, Total Equity. Balanced check.`,

  '/admin/finance/cash-flow': `Cash Flow statement. Metrics: Opening Balance, Inflow, Outflow, Closing Balance. Cash flow by account category.`,

  '/admin/finance/trial-balance': `Trial Balance. All GL accounts with debit/credit balances. Metrics: Total Debits, Total Credits, Balanced flag. As-of-date filter.`,

  '/admin/finance/ledger': `General Ledger. Detailed transaction log. Metrics: Total Credits, Total Debits, Opening/Closing Balance. Filterable by user, entry type, date range.`,

  '/admin/finance/journal-entries': `Journal Entries. Manual accounting entries with reversal capability.`,

  '/admin/finance/accounts': `Chart of Accounts. Master list of GL accounts (active only). Account codes, names, types in hierarchy.`,

  '/admin/finance/profit-by-shipment': `Profit by Shipment. P&L analysis scoped to a specific shipment. Revenue, costs, profit breakdown per shipment.`,

  '/admin/finance/payout': `Payroll Batches. Monthly payroll batch management for finance approval. Status: Pending Finance, Paid.`,

  '/admin/finance/expenses': `Expense Submissions. Expense approval workflow with GL account assignment.`,

  '/admin/finance/aging': `Aging Report. Receivables/Payables aging by date buckets. Metrics: 0-30d, 31-60d, 61-90d, 90+d, Total. Kind toggle: Receivable/Payable.`,

  '/admin/finance/staff-accounts': `Staff Accounts. User roster with financial context. Status/role/branch filters.`,

  '/admin/finance/disbursements': `Disbursements. Managing payouts to staff and partners.`,

  '/admin/finance/assets': `Fixed Assets register. Asset tracking and depreciation.`,

  '/admin/finance/bank-reconciliation': `Bank Reconciliation. Matching bank statements to GL entries.`,

  '/admin/finance/budget-report': `Budget Report. Budget vs actual comparison.`,

  '/admin/finance/tax-returns': `Tax Returns. Tax filing data with date range filter.`,

  '/admin/finance/wht-certificates': `WHT Certificates. Withholding tax certificate management.`,

  '/admin/finance/opening-balances': `Opening Balances. Initial GL account balances setup.`,

  // ── Products ──
  '/admin/products': `Products page. Product catalog management. Metrics: total products, active count, unique categories. Two tabs: Products and Offers. Create, edit, import products.`,

  '/admin/categories': `Product Categories. Category management with brand contact info (name, phone, email, WhatsApp, SMS sender ID).`,

  // ── HR ──
  '/admin/hr': `HR Staff Management. Metrics: active/pending/inactive user counts, distinct roles count. Create, edit, import staff. Status/role/branch filters.`,

  '/hr/users': `Staff roster (same data as HR page). Filterable by status, role, branch. Search by name/email.`,

  '/hr/payroll': `Payroll Management. Monthly payroll batches with adjustments. Batch status totals, adjustment amounts. Generate and approve workflow.`,

  // ── Admin Tools ──
  '/admin/branches': `Branch Management. Company branches grouped by company. Create/edit branch name, code, status.`,

  '/admin/audit': `Audit Log. System-wide audit trail of all mutations with actor, timestamp, and change details.`,

  '/admin/data/export': `Data Export. Report generator for CSV/Excel exports. Scoped by closers, media buyers, products, campaigns, date range.`,

  '/admin/permission-requests': `Permission Requests. Approval queue for user creation, role changes, permission grants, product archives, order edits. Status: PENDING/APPROVED/REJECTED.`,

  '/admin/notifications': `Notifications hub. Tabs: In-app feed, broadcast push, automation rules, delivery log. Unread count, delivery status.`,

  '/admin/settings': `System Settings. Configuration for notifications, VOIP, CS dispatch strategy, profitability targets, ad spend mode.`,

  '/admin/settings/follow-up-config': `Follow-Up Config. Follow-up order distribution rules, groups, and sync logs.`,

  '/admin/settings/cs-order-routing': `CS Order Routing. Sales order routing rules by branch, product, and team.`,

  '/admin/settings/cart-order-routing': `Cart Order Routing. Cart order distribution rules.`,

  '/admin/settings/branch-groups': `Company Groups (Branch Groups). Manage company groupings for data isolation.`,

  '/admin/settings/filter-preferences': `Filter Preferences. Saved filter presets for dashboard pages.`,

  '/admin/settings/role-templates': `Role Templates. Permission template management for roles.`,

  '/admin/onboarding': `Staff Onboarding. Self-service form for personal, financial, and employment info.`,

  '/admin/leaderboards': `Global Leaderboards. Cross-team performance rankings.`,
};

function getPageContextFromPath(path: string): string {
  // Try to extract meaningful context from unknown paths
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) return 'The user is on the main dashboard.';

  const section = segments[1] || '';
  const subsection = segments[2] || '';

  if (section === 'marketing') return `The user is in the Marketing section${subsection ? `, viewing the ${subsection} page` : ''}.`;
  if (section === 'sales') return `The user is in the Sales section${subsection ? `, viewing the ${subsection} page` : ''}.`;
  if (section === 'inventory') return `The user is in the Inventory section${subsection ? `, viewing the ${subsection} page` : ''}.`;
  if (section === 'logistics') return `The user is in the Logistics section${subsection ? `, viewing the ${subsection} page` : ''}.`;
  if (section === 'finance') return `The user is in the Finance section${subsection ? `, viewing the ${subsection} page` : ''}.`;
  if (section === 'hr') return `The user is in the HR section${subsection ? `, viewing the ${subsection} page` : ''}.`;
  if (section === 'orders') return `The user is viewing an order detail page.`;

  return `The user is viewing: /${segments.join('/')}`;
}

/** Parse URL search params into human-readable filter context for the AI */
function parseFiltersForContext(search: string): string {
  try {
    const params = new URLSearchParams(search);
    const filters: string[] = [];
    // Map common param names to friendly labels
    const labelMap: Record<string, string> = {
      startDate: 'Start date', endDate: 'End date',
      branchId: 'Branch', status: 'Status',
      mediaBuyerId: 'Media buyer', closerId: 'CS closer',
      productId: 'Product', locationId: 'Location',
      teamId: 'Team', search: 'Search query',
      tab: 'Active tab', page: 'Page number',
      periodAllTime: 'Period', providerId: 'Provider',
      shipmentId: 'Shipment', companyId: 'Company',
    };
    for (const [key, value] of params.entries()) {
      if (!value || key === 'page' || key === 'perPage') continue; // skip pagination noise
      const label = labelMap[key] || key;
      filters.push(`${label}: ${value}`);
    }
    return filters.length > 0 ? filters.join(', ') : 'No active filters (default view)';
  } catch {
    return search;
  }
}

// ─── Rate Limiting (in-memory, per-process) ──────────────────────────

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX = 30;
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count++;
  return true;
}

// ─── Service ─────────────────────────────────────────────────────────

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private toolServices: ToolExecutorServices | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Called from trpc.module.ts to inject tool services for the streaming endpoint. */
  setToolServices(services: ToolExecutorServices) {
    this.toolServices = services;
  }

  private getToolServices(): ToolExecutorServices {
    if (!this.toolServices) throw new Error('Tool services not initialized');
    return this.toolServices;
  }

  // ── Session CRUD ─────────────────────────────────────

  private static MAX_SESSIONS_PER_USER = 7;

  async createSession(userId: string, title?: string): Promise<{ id: string }> {
    const id = randomUUID();
    await this.db.insert(schema.aiChatSessions).values({
      id,
      userId,
      title: title || 'New conversation',
    });

    // Enforce max sessions: delete oldest beyond the cap
    const allSessions = await this.db
      .select({ id: schema.aiChatSessions.id })
      .from(schema.aiChatSessions)
      .where(eq(schema.aiChatSessions.userId, userId))
      .orderBy(desc(schema.aiChatSessions.updatedAt));

    if (allSessions.length > AiAssistantService.MAX_SESSIONS_PER_USER) {
      const toDelete = allSessions.slice(AiAssistantService.MAX_SESSIONS_PER_USER).map((s) => s.id);
      if (toDelete.length > 0) {
        await this.db
          .delete(schema.aiChatSessions)
          .where(inArray(schema.aiChatSessions.id, toDelete));
      }
    }

    return { id };
  }

  async listSessions(userId: string, limit = 20, offset = 0) {
    const sessions = await this.db
      .select({
        id: schema.aiChatSessions.id,
        title: schema.aiChatSessions.title,
        createdAt: schema.aiChatSessions.createdAt,
        updatedAt: schema.aiChatSessions.updatedAt,
      })
      .from(schema.aiChatSessions)
      .where(eq(schema.aiChatSessions.userId, userId))
      .orderBy(desc(schema.aiChatSessions.updatedAt))
      .limit(limit)
      .offset(offset);
    return sessions;
  }

  async getSessionMessages(sessionId: string, userId: string) {
    // Ownership check
    const [session] = await this.db
      .select({ id: schema.aiChatSessions.id })
      .from(schema.aiChatSessions)
      .where(
        and(
          eq(schema.aiChatSessions.id, sessionId),
          eq(schema.aiChatSessions.userId, userId),
        ),
      )
      .limit(1);

    if (!session) throw new Error('Session not found');

    return this.db
      .select({
        id: schema.aiChatMessages.id,
        role: schema.aiChatMessages.role,
        content: schema.aiChatMessages.content,
        createdAt: schema.aiChatMessages.createdAt,
      })
      .from(schema.aiChatMessages)
      .where(eq(schema.aiChatMessages.sessionId, sessionId))
      .orderBy(asc(schema.aiChatMessages.createdAt));
  }

  async deleteSession(sessionId: string, userId: string) {
    const deleted = await this.db
      .delete(schema.aiChatSessions)
      .where(
        and(
          eq(schema.aiChatSessions.id, sessionId),
          eq(schema.aiChatSessions.userId, userId),
        ),
      )
      .returning({ id: schema.aiChatSessions.id });

    if (deleted.length === 0) throw new Error('Session not found');
  }

  // ── API Key Management ───────────────────────────────

  async saveOrgApiKey(apiKey: string, groupId: string | null, updatedBy: string): Promise<void> {
    const encrypted = encryptApiKey(apiKey);
    const existing = await this.db
      .select({ id: schema.systemSettings.id })
      .from(schema.systemSettings)
      .where(
        and(
          eq(schema.systemSettings.key, 'AI_CLAUDE_API_KEY'),
          groupId
            ? eq(schema.systemSettings.groupId, groupId)
            : undefined as any,
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(schema.systemSettings)
        .set({ value: { encryptedKey: encrypted }, updatedBy })
        .where(eq(schema.systemSettings.id, existing[0]!.id));
    } else {
      await this.db.insert(schema.systemSettings).values({
        id: randomUUID(),
        key: 'AI_CLAUDE_API_KEY',
        groupId,
        value: { encryptedKey: encrypted },
        updatedBy,
      });
    }
  }

  async deleteOrgApiKey(groupId: string | null): Promise<void> {
    await this.db
      .delete(schema.systemSettings)
      .where(
        and(
          eq(schema.systemSettings.key, 'AI_CLAUDE_API_KEY'),
          groupId
            ? eq(schema.systemSettings.groupId, groupId)
            : undefined as any,
        ),
      );
  }

  async orgApiKeyExists(groupId: string | null): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.systemSettings.id })
      .from(schema.systemSettings)
      .where(
        and(
          eq(schema.systemSettings.key, 'AI_CLAUDE_API_KEY'),
          groupId
            ? eq(schema.systemSettings.groupId, groupId)
            : undefined as any,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async savePersonalApiKey(apiKey: string, userId: string): Promise<void> {
    const encrypted = encryptApiKey(apiKey);
    const existing = await this.db
      .select({ id: schema.aiUserApiKeys.id })
      .from(schema.aiUserApiKeys)
      .where(eq(schema.aiUserApiKeys.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(schema.aiUserApiKeys)
        .set({ encryptedKey: encrypted, updatedAt: new Date() })
        .where(eq(schema.aiUserApiKeys.id, existing[0]!.id));
    } else {
      await this.db.insert(schema.aiUserApiKeys).values({
        id: randomUUID(),
        userId,
        encryptedKey: encrypted,
      });
    }
  }

  async deletePersonalApiKey(userId: string): Promise<void> {
    await this.db
      .delete(schema.aiUserApiKeys)
      .where(eq(schema.aiUserApiKeys.userId, userId));
  }

  async personalApiKeyExists(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.aiUserApiKeys.id })
      .from(schema.aiUserApiKeys)
      .where(eq(schema.aiUserApiKeys.userId, userId))
      .limit(1);
    return rows.length > 0;
  }

  private async resolveApiKey(userId: string, groupId: string | null): Promise<string | null> {
    // Personal key takes priority
    const [personal] = await this.db
      .select({ encryptedKey: schema.aiUserApiKeys.encryptedKey })
      .from(schema.aiUserApiKeys)
      .where(eq(schema.aiUserApiKeys.userId, userId))
      .limit(1);

    if (personal) {
      try {
        return decryptApiKey(personal.encryptedKey);
      } catch {
        this.logger.warn(`Failed to decrypt personal API key for user ${userId}`);
      }
    }

    // Fallback to org key
    const [org] = await this.db
      .select({ value: schema.systemSettings.value })
      .from(schema.systemSettings)
      .where(
        and(
          eq(schema.systemSettings.key, 'AI_CLAUDE_API_KEY'),
          groupId
            ? eq(schema.systemSettings.groupId, groupId)
            : undefined as any,
        ),
      )
      .limit(1);

    if (org?.value && typeof org.value === 'object' && 'encryptedKey' in org.value) {
      try {
        return decryptApiKey(org.value.encryptedKey as string);
      } catch {
        this.logger.warn('Failed to decrypt org API key');
      }
    }

    return null;
  }

  // ── Chat ─────────────────────────────────────────────

  async sendMessage(params: {
    sessionId?: string;
    userId: string;
    userMessage: string;
    model?: string;
    currentPage?: string;
    currentFilters?: string;
    user: ToolExecutorUser;
    branchId: string | null;
    effectiveBranchIds: string[] | null;
    activeGroupId: string | null;
    services: ToolExecutorServices;
  }): Promise<{
    sessionId: string;
    assistantMessage: string;
    sessionTitle?: string;
  }> {
    const { userId, userMessage, model, currentPage, currentFilters, user, branchId, effectiveBranchIds, activeGroupId, services } = params;

    // Rate limit
    if (!checkRateLimit(userId)) {
      throw new Error('Rate limit exceeded. Please wait a few minutes before sending more messages.');
    }

    // Resolve API key
    const apiKey = await this.resolveApiKey(userId, activeGroupId);
    if (!apiKey) {
      throw new Error('No Claude API key configured. Please add your API key in the AI Assistant settings, or ask your admin to set an organization key.');
    }

    // Create or verify session
    let sessionId = params.sessionId;
    if (!sessionId) {
      const session = await this.createSession(userId);
      sessionId = session.id;
    } else {
      // Verify ownership
      const [session] = await this.db
        .select({ id: schema.aiChatSessions.id })
        .from(schema.aiChatSessions)
        .where(
          and(
            eq(schema.aiChatSessions.id, sessionId),
            eq(schema.aiChatSessions.userId, userId),
          ),
        )
        .limit(1);
      if (!session) throw new Error('Session not found');
    }

    // Persist user message
    await this.db.insert(schema.aiChatMessages).values({
      id: randomUUID(),
      sessionId,
      role: 'user',
      content: userMessage,
    });

    // Load conversation history (last 50 messages for context)
    const history = await this.db
      .select({
        role: schema.aiChatMessages.role,
        content: schema.aiChatMessages.content,
      })
      .from(schema.aiChatMessages)
      .where(eq(schema.aiChatMessages.sessionId, sessionId))
      .orderBy(asc(schema.aiChatMessages.createdAt))
      .limit(50);

    // Build messages array for Claude
    const messages = history.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    // Call Claude with tool loop
    const toolCtx: ToolExecutorContext = { user, branchId, effectiveBranchIds, activeGroupId };
    let assistantMessage: string;
    try {
      assistantMessage = await this.callClaude(apiKey, messages, toolCtx, services, model, currentPage, currentFilters);
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode;
      const errType = err?.error?.error?.type ?? err?.type ?? '';
      const errMsg = err?.error?.error?.message ?? err?.message ?? '';
      if (status === 401 || errType === 'authentication_error') {
        throw new Error('CLAUDE_AUTH_ERROR');
      } else if (status === 404 || errType === 'not_found_error') {
        throw new Error(`CLAUDE_MODEL_NOT_FOUND:${model || 'claude-haiku-4-5-20251001'}`);
      } else if (status === 429 || errType === 'rate_limit_error') {
        throw new Error('CLAUDE_RATE_LIMIT');
      } else if (errType === 'invalid_request_error' && errMsg.includes('credit')) {
        throw new Error('CLAUDE_NO_CREDITS');
      } else if (status === 400 || errType === 'invalid_request_error') {
        throw new Error(`CLAUDE_INVALID_REQUEST:${errMsg}`);
      }
      throw err;
    }

    // Persist assistant message
    await this.db.insert(schema.aiChatMessages).values({
      id: randomUUID(),
      sessionId,
      role: 'assistant',
      content: assistantMessage,
    });

    // Update session title from first message if it's a new session
    let sessionTitle: string | undefined;
    if (!params.sessionId) {
      sessionTitle = userMessage.length > 60
        ? userMessage.slice(0, 57) + '...'
        : userMessage;
      await this.db
        .update(schema.aiChatSessions)
        .set({ title: sessionTitle, updatedAt: new Date() })
        .where(eq(schema.aiChatSessions.id, sessionId));
    } else {
      await this.db
        .update(schema.aiChatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(schema.aiChatSessions.id, sessionId));
    }

    return { sessionId, assistantMessage, sessionTitle };
  }

  // ── Streaming Chat ───────────────────────────────────

  async sendMessageStreaming(params: {
    sessionId?: string;
    userId: string;
    userMessage: string;
    model?: string;
    currentPage?: string;
    currentFilters?: string;
    user: ToolExecutorUser;
    branchId: string | null;
    effectiveBranchIds: string[] | null;
    activeGroupId: string | null;
    onEvent: (event: string, data: string) => void;
  }): Promise<void> {
    const { userId, userMessage, model, currentPage, currentFilters, user, branchId, effectiveBranchIds, activeGroupId, onEvent } = params;

    if (!checkRateLimit(userId)) {
      throw new Error('Rate limit exceeded. Please wait a few minutes before sending more messages.');
    }

    const apiKey = await this.resolveApiKey(userId, activeGroupId);
    if (!apiKey) {
      throw new Error('No Claude API key configured. Please add your API key in the AI Assistant settings.');
    }

    // Create or verify session
    let sessionId = params.sessionId;
    if (!sessionId) {
      const session = await this.createSession(userId);
      sessionId = session.id;
    } else {
      const [session] = await this.db
        .select({ id: schema.aiChatSessions.id })
        .from(schema.aiChatSessions)
        .where(and(eq(schema.aiChatSessions.id, sessionId), eq(schema.aiChatSessions.userId, userId)))
        .limit(1);
      if (!session) throw new Error('Session not found');
    }

    // Send session info
    const sessionTitle = !params.sessionId
      ? (userMessage.length > 60 ? userMessage.slice(0, 57) + '...' : userMessage)
      : undefined;
    onEvent('session', JSON.stringify({ sessionId, sessionTitle }));

    // Persist user message
    await this.db.insert(schema.aiChatMessages).values({ id: randomUUID(), sessionId, role: 'user', content: userMessage });

    // Load history
    const history = await this.db
      .select({ role: schema.aiChatMessages.role, content: schema.aiChatMessages.content })
      .from(schema.aiChatMessages)
      .where(eq(schema.aiChatMessages.sessionId, sessionId))
      .orderBy(asc(schema.aiChatMessages.createdAt))
      .limit(50);

    const messages = history.map((msg) => ({ role: msg.role as 'user' | 'assistant', content: msg.content }));

    // Import SDK + build prompt
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const resolvedModel = model || 'claude-haiku-4-5-20251001';

    let systemPrompt = SYSTEM_PROMPT;
    if (currentPage) {
      systemPrompt += `\n\n## Current Context\nThe user is currently viewing: ${currentPage}\n${PAGE_CONTEXT_MAP[currentPage] || getPageContextFromPath(currentPage)}`;
      if (currentFilters) {
        systemPrompt += `\n\nActive filters/parameters on this page: ${parseFiltersForContext(currentFilters)}`;
        systemPrompt += `\nWhen the user says "this page", "what I'm looking at", or "analyze this", use these filters to scope your tool calls to match what they see on screen.`;
      }
    }

    const toolCtx: ToolExecutorContext = { user, branchId, effectiveBranchIds, activeGroupId };
    let currentMessages: any[] = [...messages];
    const maxToolRounds = 5;
    let fullResponse = '';

    for (let round = 0; round < maxToolRounds; round++) {
      const stream = client.messages.stream({
        model: resolvedModel,
        max_tokens: 4096,
        system: systemPrompt,
        tools: AI_TOOLS as any,
        messages: currentMessages,
      });

      let hasToolUse = false;
      const contentBlocks: any[] = [];
      const toolUseBlocks: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = [];
      let currentToolBlock: { id: string; name: string; inputJson: string } | null = null;
      let currentTextContent = '';

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = (event as any).content_block;
          if (block?.type === 'tool_use') {
            hasToolUse = true;
            currentToolBlock = { id: block.id, name: block.name, inputJson: '' };
            onEvent('status', JSON.stringify({ message: 'Querying your data...' }));
          } else if (block?.type === 'text') {
            currentTextContent = '';
          }
        } else if (event.type === 'content_block_delta') {
          const delta = (event as any).delta;
          if (delta?.type === 'text_delta' && delta.text) {
            fullResponse += delta.text;
            currentTextContent += delta.text;
            onEvent('text', JSON.stringify({ text: delta.text }));
          } else if (delta?.type === 'input_json_delta' && currentToolBlock) {
            currentToolBlock.inputJson += delta.partial_json ?? '';
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolBlock) {
            let parsedInput: Record<string, unknown> = {};
            try { parsedInput = JSON.parse(currentToolBlock.inputJson || '{}'); } catch {}
            const tb = { type: 'tool_use' as const, id: currentToolBlock.id, name: currentToolBlock.name, input: parsedInput };
            toolUseBlocks.push(tb);
            contentBlocks.push(tb);
            currentToolBlock = null;
          } else if (currentTextContent) {
            contentBlocks.push({ type: 'text', text: currentTextContent });
            currentTextContent = '';
          }
        }
      }

      if (!hasToolUse) break;

      // Execute tools
      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
      for (const tb of toolUseBlocks) {
        const result = await executeTool(tb.name, tb.input, toolCtx, this.getToolServices());
        toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: result });
      }

      // Build the next round's messages using collected content blocks
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: contentBlocks },
        { role: 'user', content: toolResults },
      ];

      onEvent('status', JSON.stringify({ message: 'Generating response...' }));
    }

    // Persist assistant message
    if (fullResponse) {
      await this.db.insert(schema.aiChatMessages).values({ id: randomUUID(), sessionId, role: 'assistant', content: fullResponse });
    }

    // Update session
    if (!params.sessionId && sessionTitle) {
      await this.db.update(schema.aiChatSessions).set({ title: sessionTitle, updatedAt: new Date() }).where(eq(schema.aiChatSessions.id, sessionId));
    } else {
      await this.db.update(schema.aiChatSessions).set({ updatedAt: new Date() }).where(eq(schema.aiChatSessions.id, sessionId));
    }
  }

  private async callClaude(
    apiKey: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    toolCtx: ToolExecutorContext,
    services: ToolExecutorServices,
    model?: string,
    currentPage?: string,
    currentFilters?: string,
  ): Promise<string> {
    // Dynamic import to avoid loading SDK when not needed
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const resolvedModel = model || 'claude-haiku-4-5-20251001';
    let currentMessages: any[] = [...messages];
    const maxToolRounds = 5;

    // Build system prompt with page context
    let systemPrompt = SYSTEM_PROMPT;
    if (currentPage) {
      systemPrompt += `\n\n## Current Context\nThe user is currently viewing: ${currentPage}\n${PAGE_CONTEXT_MAP[currentPage] || getPageContextFromPath(currentPage)}`;
      if (currentFilters) {
        systemPrompt += `\n\nActive filters/parameters on this page: ${parseFiltersForContext(currentFilters)}`;
        systemPrompt += `\nWhen the user says "this page", "what I'm looking at", or "analyze this", use these filters to scope your tool calls to match what they see on screen.`;
      }
    }

    for (let round = 0; round < maxToolRounds; round++) {
      const response = await client.messages.create({
        model: resolvedModel,
        max_tokens: 4096,
        system: systemPrompt,
        tools: AI_TOOLS as any,
        messages: currentMessages,
      });

      // Check if we need to process tool calls
      const toolUseBlocks = response.content.filter(
        (block: any) => block.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0) {
        // No tool calls — extract text response
        const textParts = response.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => (block as any).text as string);
        return textParts.join('\n') || 'I was unable to generate a response.';
      }

      // Execute tools and build tool_result messages
      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

      for (const toolBlock of toolUseBlocks) {
        const tb = toolBlock as any;
        const result = await executeTool(
          tb.name as string,
          tb.input as Record<string, unknown>,
          toolCtx,
          services,
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id as string,
          content: result,
        });
      }

      // Append assistant response and tool results for next round
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ];
    }

    return 'I needed more steps to answer your question. Please try rephrasing or breaking your request into smaller parts.';
  }

}
