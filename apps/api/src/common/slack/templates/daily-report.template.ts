import { buildAlert, summary, divider, codeBlock } from '../slack.helpers';
import { AlertSeverity, SLACK_APP_NAME, SLACK_APP_EMOJI } from '../slack-channels';
import type { SlackBlock, SlackField, SlackTemplateResult } from '../slack.types';

export interface DailyReportErrorGroup {
  path: string;
  count: number;
  lastMessage: string;
}

export interface DailyReportData {
  reportDate: string;
  ordersCreated: number;
  ordersByStatus: Array<{ status: string; count: number }>;
  newUsers: number;
  /** Approved + pending AD_SPEND category spend logged today, in naira. */
  adSpendToday: number;
  /** Orders delivered today (by delivered_at). */
  ordersDelivered: number;
  /** Blended CPA = ad spend / orders created today. null when no orders created. */
  cpaCreated: number | null;
  /** Blended CPA = ad spend / orders delivered today. null when nothing delivered. */
  cpaDelivered: number | null;
  errorTotal: number;
  errorGroups: DailyReportErrorGroup[];
  dbHealthy: boolean;
  dbLatencyMs: number | null;
}

export function dailyReportTemplate(data: DailyReportData): SlackTemplateResult {
  const severity = data.errorTotal > 0 || !data.dbHealthy
    ? AlertSeverity.WARNING
    : AlertSeverity.REPORT;

  const statusFields: SlackField[] = data.ordersByStatus
    .filter((s) => s.count > 0)
    .map((s) => ({ label: humanizeStatus(s.status), value: String(s.count) }));

  const extraBlocks: SlackBlock[] = [];

  extraBlocks.push(divider());
  extraBlocks.push(summary(':bar_chart: *Orders created today*'));
  if (statusFields.length > 0) {
    extraBlocks.push({ type: 'section', fields: statusFields.map((f) => ({ type: 'mrkdwn', text: `*${f.label}*\n${f.value}` })) });
  } else {
    extraBlocks.push(summary('_No orders created today._'));
  }

  extraBlocks.push(divider());
  extraBlocks.push(summary(':moneybag: *Marketing today*'));
  const marketingFields: SlackField[] = [
    { label: 'Ad Spend', value: formatNaira(data.adSpendToday) },
    { label: 'CPA (created)', value: data.cpaCreated !== null ? formatNaira(data.cpaCreated) : '—' },
    { label: 'Delivered', value: String(data.ordersDelivered) },
    { label: 'CPA (delivered)', value: data.cpaDelivered !== null ? formatNaira(data.cpaDelivered) : '—' },
  ];
  extraBlocks.push({ type: 'section', fields: marketingFields.map((f) => ({ type: 'mrkdwn', text: `*${f.label}*\n${f.value}` })) });

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
      .map((g) => `${g.count}×  ${g.path}  —  ${truncate(g.lastMessage, 80)}`)
      .join('\n');
    extraBlocks.push(codeBlock(lines || 'grouped errors unavailable'));
  }

  return buildAlert(`Daily report — ${data.reportDate}`, {
    severity,
    appName: SLACK_APP_NAME,
    appEmoji: SLACK_APP_EMOJI,
    title: `:calendar: Daily Report — ${data.reportDate}`,
    summaryText:
      `*${data.ordersCreated}* orders created  ·  *${data.ordersDelivered}* delivered  ·  ` +
      `*${formatNaira(data.adSpendToday)}* ad spend  ·  *${data.cpaCreated !== null ? formatNaira(data.cpaCreated) : '—'}* CPA  ·  ` +
      `*${data.newUsers}* new users  ·  *${data.errorTotal}* API errors`,
    extraBlocks,
  });
}

/** Naira with thousands separators, no decimals (e.g. ₦1,250,000). */
function formatNaira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString('en-NG')}`;
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
