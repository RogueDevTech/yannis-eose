import { useCallback, useMemo, useState } from 'react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { Modal } from '~/components/ui/modal';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { downloadPayslipPdf } from '~/lib/payslip-pdf';
import type { PayslipListItem } from './payroll-prd-types';

interface PayrollPayslipsPageProps {
  items: PayslipListItem[];
  page: number;
  limit: number;
}

function formatPeriod(month: string): string {
  const d = new Date(month);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
}

function parseBonusLines(breakdown: unknown): Array<{ label: string; amount: number }> {
  if (!Array.isArray(breakdown)) return [];
  return breakdown
    .map((line) => {
      if (!line || typeof line !== 'object') return null;
      const obj = line as Record<string, unknown>;
      const label = String(obj.label ?? obj.name ?? 'Bonus');
      const amount = Number(obj.amount ?? 0);
      if (!Number.isFinite(amount)) return null;
      return { label, amount };
    })
    .filter((x): x is { label: string; amount: number } => x != null);
}

function PayslipDetailLine({ label, amount, bold }: { label: string; amount: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-2 ${bold ? 'font-semibold text-app-fg' : 'text-sm text-app-fg-muted'}`}>
      <span>{label}</span>
      <NairaPrice amount={amount} />
    </div>
  );
}

export function PayrollPayslipsPage({ items, page, limit }: PayrollPayslipsPageProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [viewingPayslip, setViewingPayslip] = useState<PayslipListItem | null>(null);

  const handleDownload = useCallback(async (row: PayslipListItem) => {
    const { payout, batch, staffName } = row;
    setDownloadingId(payout.id);
    try {
      const periodLabel = formatPeriod(batch.periodMonth);
      const filename = `payslip-${(staffName ?? 'staff').replace(/\s+/g, '-').toLowerCase()}-${batch.periodMonth.slice(0, 7)}.pdf`;
      await downloadPayslipPdf(
        {
          periodLabel,
          employeeName: staffName ?? 'Staff',
          employeeId: payout.staffId ?? undefined,
          roleName: payout.payRoleName ?? undefined,
          baseSalary: Number(payout.baseSalary),
          performanceBonus: Number(payout.performanceBonus),
          allowancesTotal: Number(payout.allowancesTotal),
          addOnsTotal: Number(payout.addOnsTotal),
          deductionsTotal: Number(payout.deductionsTotal),
          grossPay: Number(payout.grossPay),
          payeTax: Number(payout.payeTax),
          netPay: Number(payout.netPay),
          bonusLines: parseBonusLines(payout.bonusBreakdown),
        },
        filename,
      );
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const columns: CompactTableColumn<PayslipListItem>[] = useMemo(
    () => [
      {
        key: 'staff',
        header: 'Employee',
        hideable: false,
        render: (row) => (
          <span className="font-medium text-app-fg">{row.staffName ?? 'Unknown'}</span>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        nowrap: true,
        render: (row) => (
          <span className="text-sm text-app-fg-muted">{row.payout.payRoleName ?? '—'}</span>
        ),
      },
      {
        key: 'period',
        header: 'Period',
        nowrap: true,
        render: (row) => (
          <span className="text-sm text-app-fg-muted">{formatPeriod(row.batch.periodMonth)}</span>
        ),
      },
      {
        key: 'gross',
        header: 'Gross',
        align: 'right',
        render: (row) => <NairaPrice amount={Number(row.payout.grossPay)} />,
      },
      {
        key: 'net',
        header: 'Net pay',
        align: 'right',
        render: (row) => (
          <span className="font-semibold text-app-fg">
            <NairaPrice amount={Number(row.payout.netPay)} />
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        hideable: false,
        render: (row) => (
          <div className="flex items-center gap-1.5">
            <CompactTableActionButton onClick={() => setViewingPayslip(row)}>
              View
            </CompactTableActionButton>
            <CompactTableActionButton
              tone="brand"
              disabled={downloadingId === row.payout.id}
              onClick={() => void handleDownload(row)}
            >
              {downloadingId === row.payout.id ? 'Generating…' : 'PDF'}
            </CompactTableActionButton>
          </div>
        ),
      },
    ],
    [downloadingId, handleDownload],
  );

  const vp = viewingPayslip;
  const bonusLines = vp ? parseBonusLines(vp.payout.bonusBreakdown) : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payslips"
        mobileInlineActions
        description="Paid payout lines with downloadable PDF payslips."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Payslips toolbar"
            desktop={<PageRefreshButton />}
          />
        }
      />

      <p className="text-xs text-app-fg-muted">
        Showing page {page} · up to {limit} records per page (PAID batches only).
      </p>

      {items.length === 0 ? (
        <EmptyState
          title="No payslips yet"
          description="Payslips appear after Finance marks payroll batches as paid."
        />
      ) : (
        <CompactTable<PayslipListItem>
          columnVisibilityKey="hr.payroll.payslips"
          columns={columns}
          rows={items}
          rowKey={(r) => r.payout.id}
          emptyTitle="No payslips"
          emptyDescription=""
        />
      )}

      {/* ── Payslip Detail Modal ── */}
      <Modal open={!!vp} onClose={() => setViewingPayslip(null)} maxWidth="max-w-md" contentClassName="p-5 space-y-5">
        {vp && (
          <>
            <div>
              <h2 className="text-lg font-semibold text-app-fg">{vp.staffName ?? 'Staff'}</h2>
              <p className="text-sm text-app-fg-muted mt-0.5">
                {vp.payout.payRoleName ? `${vp.payout.payRoleName} \u00b7 ` : ''}{formatPeriod(vp.batch.periodMonth)} \u00b7 {vp.batch.department}
              </p>
            </div>

            {/* Earnings */}
            <div>
              <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-2">Earnings</h3>
              <div className="divide-y divide-app-border">
                <PayslipDetailLine label="Base Salary" amount={Number(vp.payout.baseSalary)} />
                {Number(vp.payout.performanceBonus) > 0 && (
                  <PayslipDetailLine label="Performance Bonus" amount={Number(vp.payout.performanceBonus)} />
                )}
                {bonusLines.map((bl, i) => (
                  <PayslipDetailLine key={i} label={bl.label} amount={bl.amount} />
                ))}
                {Number(vp.payout.allowancesTotal) > 0 && (
                  <PayslipDetailLine label="Allowances" amount={Number(vp.payout.allowancesTotal)} />
                )}
                {Number(vp.payout.addOnsTotal) > 0 && (
                  <PayslipDetailLine label="Add-ons" amount={Number(vp.payout.addOnsTotal)} />
                )}
                <PayslipDetailLine label="Gross Pay" amount={Number(vp.payout.grossPay)} bold />
              </div>
            </div>

            {/* Deductions */}
            <div>
              <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-2">Deductions</h3>
              <div className="divide-y divide-app-border">
                {Number(vp.payout.payeTax) > 0 && (
                  <PayslipDetailLine label="PAYE Tax" amount={Number(vp.payout.payeTax)} />
                )}
                {Number(vp.payout.deductionsTotal) > 0 && (
                  <PayslipDetailLine label="Other Deductions" amount={Number(vp.payout.deductionsTotal)} />
                )}
                <PayslipDetailLine label="Total Deductions" amount={Number(vp.payout.payeTax) + Number(vp.payout.deductionsTotal)} bold />
              </div>
            </div>

            {/* Net Pay */}
            <div className="rounded-lg bg-app-hover px-4 py-3 flex justify-between items-center">
              <span className="font-semibold text-app-fg">Net Pay</span>
              <span className="text-lg font-bold text-success-600 dark:text-success-400">
                <NairaPrice amount={Number(vp.payout.netPay)} />
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-1 border-t border-app-border">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-medium text-app-fg-muted hover:bg-app-hover transition-colors"
                onClick={() => setViewingPayslip(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
                disabled={downloadingId === vp.payout.id}
                onClick={() => void handleDownload(vp)}
              >
                {downloadingId === vp.payout.id ? 'Generating\u2026' : 'Download PDF'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
