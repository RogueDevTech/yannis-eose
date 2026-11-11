/**
 * Funding Reconciliation export (Excel + PDF). Built only from the
 * reconciliation the page is showing, so exported figures always match it.
 */
import type { FundingReconciliation, ReconciliationFigures } from './types';
import { periodLabel } from './reconciliation-period';

const KIND_LABELS: Record<string, string> = {
  funding_in: 'Funds received',
  funding_out: 'Funds sent on',
  expense: 'Expense',
  refund_out: 'Refund paid out',
  refund_in: 'Refund received',
  adjustment_credit: 'Adjustment (credit)',
  adjustment_debit: 'Adjustment (debit)',
  correction: 'Prior-period correction',
};

export function movementKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

const n = (v: string | number) => Number(v);
const money = (v: string | number) =>
  `₦${n(v).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

/** The reconciliation lines in ticket order, with the sign that applies to the balance. */
export function summaryLines(f: ReconciliationFigures): Array<{ label: string; value: number; sign: '+' | '-' | '=' }> {
  return [
    { label: 'Opening balance', value: n(f.opening), sign: '=' },
    { label: 'Funds received', value: n(f.received), sign: '+' },
    { label: 'Refunds received back', value: n(f.refundsIn), sign: '+' },
    { label: 'Approved credits', value: n(f.credits), sign: '+' },
    { label: 'Prior-period corrections', value: n(f.corrections), sign: n(f.corrections) < 0 ? '-' : '+' },
    { label: 'Expenses (approved)', value: n(f.expenses), sign: '-' },
    { label: 'Funds sent on', value: n(f.distributed), sign: '-' },
    { label: 'Refunds paid out', value: n(f.refundsOut), sign: '-' },
    { label: 'Approved debits', value: n(f.debits), sign: '-' },
    { label: 'Closing balance (carried forward)', value: n(f.closing), sign: '=' },
  ];
}

function exportTitle(d: FundingReconciliation): { title: string; subtitle: string; period: string; file: string } {
  const period = periodLabel(d.period.view, d.period.startDate ?? '', d.period.endDate ?? '');
  const slug = d.user.name.replace(/\s+/g, '-').toLowerCase();
  const range = d.period.startDate ? `${d.period.startDate}_${d.period.endDate}` : 'all-time';
  return {
    title: `Funding Reconciliation: ${d.user.name}`,
    subtitle: `${period}${d.frozen ? ' (closed month, frozen figures)' : ''} · Currency NGN`,
    period,
    file: `funding-reconciliation-${slug}-${range}`,
  };
}

function sheetRows(d: FundingReconciliation) {
  const { period } = exportTitle(d);
  const summary: Array<Array<string | number>> = [
    ['Media Buyer', d.user.name],
    ['Reporting period', period],
    ['From', d.period.startDate ?? 'Beginning'],
    ['To', d.period.endDate ?? 'Today'],
    ['Currency', 'NGN'],
    ['Figures', d.frozen ? `Frozen at month close (${d.closedPeriod ? day(d.closedPeriod.closedAt) : ''})` : 'Live'],
    [],
    ['Line', 'Amount'],
    ...summaryLines(d.summary).map((l) => [l.label, l.sign === '-' ? -l.value : l.value]),
    [],
    ['To date', ''],
    ['Total funds received', n(d.toDate.received)],
    ['Total expenses', n(d.toDate.expenses)],
    ['Total refunds made', n(d.toDate.refundsOut)],
    ['Total refunds received', n(d.toDate.refundsIn)],
    ['On hold: pending expenses', n(d.toDate.pendingExpenses)],
    ['On hold: refunds awaiting completion', n(d.toDate.pendingRefunds)],
    ['Current available balance', n(d.toDate.available)],
    ['Balance check', d.check.ok ? 'Matches' : `Differs by ${money(d.check.difference)}`],
  ];
  if (d.closedPeriod) {
    summary.push([], ['Closed month', d.closedPeriod.month], ['Live closing today', n(d.closedPeriod.live.closing)], ['Changed since close', n(d.closedPeriod.drift)]);
  }
  if (d.priorCorrection) {
    summary.push([], [`Corrections from closed ${d.priorCorrection.month}`, n(d.priorCorrection.amount)]);
  }
  const compare: Array<Array<string | number>> = [];
  if (d.comparison) {
    const then = summaryLines(d.comparison.summary);
    compare.push(['Line', period, `${d.comparison.startDate} to ${d.comparison.endDate}`, 'Change']);
    summaryLines(d.summary).forEach((l, i) => {
      const prev = then[i]!.value;
      compare.push([l.label, l.value, prev, l.value - prev]);
    });
  }
  const check: Array<Array<string | number>> = [
    ['Part', 'From transactions', 'Displayed', 'Difference'],
    ...d.check.components.map((c) => [c.label, n(c.derived), n(c.system), n(c.difference)]),
    [],
    ['Reference', 'Type', 'Date', 'Status', 'From transactions', 'Displayed', 'Reason'],
    ...d.check.items.map((i) => [i.reference, movementKindLabel(i.kind), day(i.date), i.status, n(i.derived), n(i.system), i.reason]),
  ];

  const movements: Array<Array<string | number>> = [
    ['Date', 'Reference', 'Type', 'Description', 'Counterparty', 'Original funding', 'Status', 'Amount', 'Balance after'],
    ...d.movements.map((m) => [
      day(m.date),
      m.reference,
      movementKindLabel(m.kind),
      m.description,
      m.counterpartyName ?? '',
      m.fundingReference ?? '',
      m.status,
      n(m.effect),
      n(m.runningBalance),
    ]),
  ];
  const byKind = (kinds: string[]) => d.movements.filter((m) => kinds.includes(m.kind));
  const funding = [
    ['Date received', 'Reference', 'Funded by', 'Amount'],
    ...byKind(['funding_in']).map((m) => [day(m.date), m.reference, m.counterpartyName ?? '', n(m.amount)]),
    ['Total', '', '', n(d.summary.received)],
  ];
  const expenses = [
    ['Date', 'Reference', 'Description', 'Amount'],
    ...byKind(['expense']).map((m) => [day(m.date), m.reference, m.description, n(m.amount)]),
    ['Total', '', '', n(d.summary.expenses)],
  ];
  const refunds = [
    ['Completed', 'Reference', 'Direction', 'Counterparty', 'Original funding', 'Amount'],
    ...byKind(['refund_out', 'refund_in']).map((m) => [
      day(m.date),
      m.reference,
      m.kind === 'refund_out' ? 'Paid out' : 'Received back',
      m.counterpartyName ?? '',
      m.fundingReference ?? '',
      n(m.amount),
    ]),
  ];
  const adjustments = [
    ['Approved', 'Reference', 'Type', 'Reason', 'Amount'],
    ...byKind(['adjustment_credit', 'adjustment_debit', 'correction']).map((m) => [
      day(m.date),
      m.reference,
      movementKindLabel(m.kind),
      m.description,
      n(m.effect),
    ]),
  ];
  const carry = [
    ['Period', 'From', 'To', 'Opening', 'Received', 'Expenses', 'Refunds out', 'Refunds in', 'Adjustments', 'Closing'],
    ...d.breakdown.map((b) => [
      b.label,
      b.startDate,
      b.endDate,
      n(b.opening),
      n(b.received),
      n(b.expenses),
      n(b.refundsOut),
      n(b.refundsIn),
      n(b.credits) - n(b.debits) + n(b.corrections),
      n(b.closing),
    ]),
  ];
  const sources = [
    ['Received', 'Reference', 'Source', 'Amount', 'Refunded', 'Used (first in, first out)', 'Remaining'],
    ...d.funders.map((f) => [day(f.at), f.reference, f.funderName ?? f.kind, n(f.amount), n(f.refunded), n(f.used), n(f.remaining)]),
  ];
  return { summary, movements, funding, expenses, refunds, adjustments, carry, sources, compare, check };
}

function saveBlob(bytes: BlobPart, type: string, filename: string) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadReconciliationXlsx(d: FundingReconciliation): Promise<void> {
  const xlsx = await import('xlsx');
  const rows = sheetRows(d);
  const wb = xlsx.utils.book_new();
  const add = (name: string, data: Array<Array<string | number>>) =>
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(data), name);
  add('Summary', rows.summary);
  add('Transactions', rows.movements);
  add('Funding received', rows.funding);
  add('Expenses', rows.expenses);
  add('Refunds', rows.refunds);
  add('Adjustments', rows.adjustments);
  add('Carry forward', rows.carry);
  add('By funding', rows.sources);
  if (rows.compare.length) add('Compare', rows.compare);
  add('Balance check', rows.check);
  const bytes = xlsx.write(wb, { type: 'array', bookType: 'xlsx' });
  saveBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${exportTitle(d).file}.xlsx`);
}

export async function downloadReconciliationPdf(d: FundingReconciliation): Promise<void> {
  const { generateSectionedReportPdf } = await import('~/lib/finance-report-pdf');
  const t = exportTitle(d);
  const signed = (v: string) => (n(v) < 0 ? `-${money(-n(v))}` : money(v));
  const doc = await generateSectionedReportPdf({
    title: t.title,
    subtitle: t.subtitle,
    sections: [
      {
        heading: 'Reconciliation',
        items: summaryLines(d.summary).map((l) => [
          `${l.sign === '=' ? '' : `${l.sign} `}${l.label}`,
          money(l.value),
        ]),
      },
      {
        heading: 'To date',
        items: [
          ['Total funds received', money(d.toDate.received)],
          ['Total expenses', money(d.toDate.expenses)],
          ['Total refunds made', money(d.toDate.refundsOut)],
          ['Total refunds received', money(d.toDate.refundsIn)],
          ['On hold (pending expenses and refunds)', money(n(d.toDate.pendingExpenses) + n(d.toDate.pendingRefunds))],
          ['Current available balance', money(d.toDate.available)],
          ['Balance check', d.check.ok ? 'Matches' : `Differs by ${signed(d.check.difference)}`],
        ],
      },
      ...(d.comparison
        ? [
            {
              heading: `Compared with ${d.comparison.startDate} to ${d.comparison.endDate}`,
              columns: [
                { label: 'Line', width: 72 },
                { label: 'This period', width: 36, align: 'right' as const },
                { label: 'Compared', width: 36, align: 'right' as const },
                { label: 'Change', width: 36, align: 'right' as const },
              ],
              rows: (() => {
                const then = summaryLines(d.comparison!.summary);
                return summaryLines(d.summary).map((l, i) => [
                  l.label,
                  money(l.value),
                  money(then[i]!.value),
                  signed(String(l.value - then[i]!.value)),
                ]);
              })(),
            },
          ]
        : []),
      ...(d.check.items.length
        ? [
            {
              heading: 'Balance check: transactions behind the difference',
              columns: [
                { label: 'Reference', width: 30 },
                { label: 'Type', width: 30 },
                { label: 'Date', width: 24 },
                { label: 'Transactions', width: 26, align: 'right' as const },
                { label: 'Displayed', width: 26, align: 'right' as const },
                { label: 'Reason', width: 44 },
              ],
              rows: d.check.items.map((i) => [
                i.reference,
                movementKindLabel(i.kind),
                day(i.date),
                money(i.derived),
                money(i.system),
                i.reason,
              ]),
            },
          ]
        : []),
      {
        heading: 'Carry forward',
        columns: [
          { label: 'Period', width: 34 },
          { label: 'Opening', width: 24, align: 'right' },
          { label: 'Received', width: 24, align: 'right' },
          { label: 'Expenses', width: 24, align: 'right' },
          { label: 'Refunds', width: 24, align: 'right' },
          { label: 'Adjust.', width: 24, align: 'right' },
          { label: 'Closing', width: 26, align: 'right' },
        ],
        rows: d.breakdown.map((b) => [
          b.label,
          money(b.opening),
          money(b.received),
          money(b.expenses),
          signed(String(n(b.refundsIn) - n(b.refundsOut))),
          signed(String(n(b.credits) - n(b.debits) + n(b.corrections))),
          money(b.closing),
        ]),
        emptyText: 'Single-day period.',
      },
      {
        heading: 'Transactions',
        columns: [
          { label: 'Date', width: 22 },
          { label: 'Reference', width: 26 },
          { label: 'Type', width: 28 },
          { label: 'Description', width: 56 },
          { label: 'Amount', width: 24, align: 'right' },
          { label: 'Balance', width: 24, align: 'right' },
        ],
        rows: d.movements.map((m) => [
          day(m.date),
          m.reference,
          movementKindLabel(m.kind),
          m.description,
          signed(m.effect),
          money(m.runningBalance),
        ]),
        totals: ['', '', '', 'Closing balance', '', money(d.summary.closing)],
        emptyText: 'No transactions in this period.',
      },
      {
        heading: 'By funding (first in, first out)',
        columns: [
          { label: 'Received', width: 22 },
          { label: 'Reference', width: 26 },
          { label: 'Source', width: 40 },
          { label: 'Amount', width: 24, align: 'right' },
          { label: 'Refunded', width: 22, align: 'right' },
          { label: 'Used', width: 22, align: 'right' },
          { label: 'Remaining', width: 24, align: 'right' },
        ],
        rows: d.funders.map((f) => [
          day(f.at),
          f.reference,
          f.funderName ?? f.kind,
          money(f.amount),
          money(f.refunded),
          money(f.used),
          money(f.remaining),
        ]),
        emptyText: 'No funding received.',
      },
    ],
  });
  doc.save(`${t.file}.pdf`);
}
