import { symbolForCurrencyCode } from '@yannis/shared';
import { buildAlert, summary, divider, codeBlock } from '../slack.helpers';
import { AlertSeverity, SLACK_APP_NAME, SLACK_APP_EMOJI } from '../slack-channels';
import type { SlackBlock, SlackField, SlackTemplateResult } from '../slack.types';

export interface DailyReportErrorGroup {
  path: string;
  count: number;
  lastMessage: string;
}

export interface DailyReportCompany {
  /**
   * Company (branch_groups row) this section covers. Every number below is
   * scoped to the branches in this company. "Unassigned" carries the rows
   * whose branch has no company yet, so the totals still reconcile.
   */
  companyName: string;
  /**
   * The company's base currency (currencies.is_default for the group), used to
   * render its money. Companies do not share a currency, so spend and CPA must
   * never be rendered with another company's symbol.
   */
  currencyCode: string;
  ordersCreated: number;
  ordersByStatus: Array<{ status: string; count: number }>;
  newUsers: number;
  /** Approved + pending AD_SPEND category spend logged today, in the company's currency. */
  adSpendToday: number;
  /** Orders delivered today (by delivered_at). */
  ordersDelivered: number;
  /** Blended CPA = ad spend / orders created today. null when no orders created. */
  cpaCreated: number | null;
  /** Blended CPA = ad spend / orders delivered today. null when nothing delivered. */
  cpaDelivered: number | null;
}

export interface DailyReportData {
  reportDate: string;
  companies: DailyReportCompany[];
  errorTotal: number;
  errorGroups: DailyReportErrorGroup[];
  dbHealthy: boolean;
  dbLatencyMs: number | null;
}

/**
 * One message, one section per company, then a single system-health section.
 *
 * Business numbers are company-scoped, but infrastructure health is not: the
 * tRPC error digest keys on request path only and the DB check hits one
 * cluster. Keeping both in one post means the health block appears once rather
 * than repeating identically under every company, and the channel gets one
 * message a night regardless of how many companies exist.
 */
/**
 * Slack rejects/truncates an attachment past 50 blocks. Each company section
 * costs 4 blocks and the fixed health + error tail costs ~5, so cap the number
 * of rendered sections and roll the remainder into one summary line rather than
 * letting Slack silently drop the end of the report.
 */
const MAX_COMPANY_SECTIONS = 9;

export function dailyReportTemplate(data: DailyReportData): SlackTemplateResult {
  const severity = data.errorTotal > 0 || !data.dbHealthy
    ? AlertSeverity.WARNING
    : AlertSeverity.REPORT;

  const extraBlocks: SlackBlock[] = [];

  if (data.companies.length === 0) {
    extraBlocks.push(divider());
    extraBlocks.push(summary('_No companies configured._'));
  }

  const rendered = data.companies.slice(0, MAX_COMPANY_SECTIONS);
  const overflow = data.companies.slice(MAX_COMPANY_SECTIONS);

  for (const company of rendered) {
    const money = (amount: number) => formatMoney(amount, company.currencyCode);

    extraBlocks.push(divider());
    extraBlocks.push(
      summary(
        `:office: *${company.companyName}*\n` +
          `*${company.ordersCreated}* created  ·  *${company.ordersDelivered}* delivered  ·  ` +
          `*${money(company.adSpendToday)}* ad spend  ·  ` +
          `*${company.cpaCreated !== null ? money(company.cpaCreated) : 'n/a'}* CPA  ·  ` +
          `*${company.newUsers}* new users`,
      ),
    );

    const statusFields: SlackField[] = company.ordersByStatus
      .filter((s) => s.count > 0)
      .map((s) => ({ label: humanizeStatus(s.status), value: String(s.count) }));

    if (statusFields.length > 0) {
      extraBlocks.push(fieldSection(statusFields));
    } else {
      extraBlocks.push(summary('_No orders created today._'));
    }

    extraBlocks.push(
      fieldSection([
        { label: 'Ad Spend', value: money(company.adSpendToday) },
        { label: 'CPA (created)', value: company.cpaCreated !== null ? money(company.cpaCreated) : 'n/a' },
        { label: 'Delivered', value: String(company.ordersDelivered) },
        { label: 'CPA (delivered)', value: company.cpaDelivered !== null ? money(company.cpaDelivered) : 'n/a' },
      ]),
    );
  }

  if (overflow.length > 0) {
    extraBlocks.push(divider());
    const overflowCreated = overflow.reduce((sum, c) => sum + c.ordersCreated, 0);
    const overflowDelivered = overflow.reduce((sum, c) => sum + c.ordersDelivered, 0);
    extraBlocks.push(
      summary(
        `:heavy_plus_sign: *${overflow.length} more ${overflow.length === 1 ? 'company' : 'companies'}*\n` +
          `*${overflowCreated}* created  ·  *${overflowDelivered}* delivered  ·  ` +
          `${overflow.map((c) => c.companyName).join(', ')}`,
      ),
    );
  }

  extraBlocks.push(divider());
  const dbLine = data.dbHealthy
    ? `:large_green_circle: Database healthy${data.dbLatencyMs !== null ? ` (${data.dbLatencyMs}ms)` : ''}`
    : ':red_circle: Database check FAILED';
  extraBlocks.push(summary(`:heartbeat: *App health*\n${dbLine}`));

  extraBlocks.push(divider());
  if (data.errorTotal === 0) {
    extraBlocks.push(summary(':white_check_mark: *No API errors today.*'));
  } else {
    extraBlocks.push(summary(`:rotating_light: *${data.errorTotal} API error${data.errorTotal === 1 ? '' : 's'} today*`));
    const lines = data.errorGroups
      .slice(0, 15)
      .map((g) => `${g.count}×  ${g.path}  ·  ${truncate(g.lastMessage, 80)}`)
      .join('\n');
    extraBlocks.push(codeBlock(lines || 'grouped errors unavailable'));
  }

  const totalCreated = data.companies.reduce((sum, c) => sum + c.ordersCreated, 0);
  const totalDelivered = data.companies.reduce((sum, c) => sum + c.ordersDelivered, 0);
  const totalNewUsers = data.companies.reduce((sum, c) => sum + c.newUsers, 0);

  return buildAlert(`Daily report: ${data.reportDate}`, {
    severity,
    appName: SLACK_APP_NAME,
    appEmoji: SLACK_APP_EMOJI,
    title: `:calendar: Daily Report ${data.reportDate}`,
    // Ad spend is deliberately absent from the roll-up: companies can be on
    // different currencies, so a single summed figure would be meaningless.
    // Per-company spend lives in each section below.
    summaryText:
      `*${totalCreated}* orders created  ·  *${totalDelivered}* delivered  ·  ` +
      `*${totalNewUsers}* new users  ·  *${data.errorTotal}* API errors  ·  ` +
      `across *${data.companies.length}* ${data.companies.length === 1 ? 'company' : 'companies'}`,
    extraBlocks,
  });
}

function fieldSection(fields: SlackField[]): SlackBlock {
  return {
    type: 'section',
    fields: fields.map((f) => ({ type: 'mrkdwn', text: `*${f.label}*\n${f.value}` })),
  };
}

/** Company-currency money, thousands separators, no decimals (e.g. ₦1,250,000). */
function formatMoney(amount: number, currencyCode: string): string {
  return `${symbolForCurrencyCode(currencyCode)}${Math.round(amount).toLocaleString('en-NG')}`;
}

function humanizeStatus(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
