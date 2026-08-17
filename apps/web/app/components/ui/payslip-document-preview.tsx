import {
  INVOICE_LOGO_SRC,
  buildPayslipLines,
  formatPayslipDate,
  formatPayslipTimestamp,
  type PayslipPdfInput,
} from '~/lib/payslip-pdf';
import { formatNaira } from '~/lib/format-amount';

/*
 * On-screen mirror of `buildPayslipPdf` — fixed px sizes so preview matches the
 * downloaded PDF and does not follow the app font-scale setting.
 */

function PdfLikePayslip({ payslip }: { payslip: PayslipPdfInput }) {
  const { earningLines, deductionLines, postTaxLines } = buildPayslipLines(payslip);
  const money = (n: number) =>
    formatNaira(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div
      className="mx-auto max-w-[210mm] bg-white text-black shadow-sm border border-neutral-200 relative"
      style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}
    >
      <div className="px-5 pt-5 pb-6 sm:px-[20px] sm:pt-5 sm:pb-8">
        <div className="flex items-end justify-between gap-4">
          <h1 className="min-w-0 text-[24px] font-bold leading-none tracking-tight">PAYSLIP</h1>
          <img
            src={INVOICE_LOGO_SRC}
            alt="Yannis"
            className="h-9 w-auto max-w-[10.5rem] shrink-0 object-contain object-right"
            width={160}
            height={48}
            loading="eager"
            decoding="async"
          />
        </div>

        <div className="mt-3">
          <p className="text-mini font-bold leading-tight">{payslip.periodLabel}</p>
          {payslip.reference ? (
            <p className="mt-1 text-2xs leading-snug" style={{ color: 'rgb(100, 100, 100)' }}>
              {payslip.reference}
            </p>
          ) : null}
        </div>

        <div
          className="mt-2 space-y-1 text-2xs leading-snug"
          style={{ color: 'rgb(100, 100, 100)' }}
        >
          <p>Period: {payslip.periodLabel}</p>
          {payslip.issuedAt ? (
            <p>
              {payslip.issuedAtLabel ?? 'Date'}: {formatPayslipDate(payslip.issuedAt)}
            </p>
          ) : null}
        </div>

        <div className="mt-6">
          <p
            className="text-2xs font-bold uppercase tracking-normal"
            style={{ color: 'rgb(100, 100, 100)' }}
          >
            Employee
          </p>
          <p className="mt-1 text-micro font-normal leading-snug text-black">
            {payslip.employeeName?.trim() || 'Unknown'}
          </p>
          {payslip.roleName ? (
            <p className="mt-1 text-2xs leading-snug text-black">{payslip.roleName}</p>
          ) : null}
          {payslip.department ? (
            <p className="mt-1 text-2xs leading-snug text-black">{payslip.department}</p>
          ) : null}
          {payslip.branchName ? (
            <p className="mt-1 text-2xs leading-snug text-black">{payslip.branchName}</p>
          ) : null}
          {payslip.employeeId ? (
            <p className="mt-1 text-2xs leading-snug" style={{ color: 'rgb(100, 100, 100)' }}>
              ID: {payslip.employeeId}
            </p>
          ) : null}
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-2xs">
            <thead>
              <tr style={{ backgroundColor: 'rgb(245, 245, 245)' }}>
                <th
                  className="px-1.5 py-2 text-left font-bold align-bottom"
                  style={{ color: 'rgb(80, 80, 80)' }}
                >
                  Description
                </th>
                <th
                  className="w-[96px] px-1 py-2 text-right font-bold align-bottom"
                  style={{ color: 'rgb(80, 80, 80)' }}
                >
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="text-black">
              {earningLines.map((line, idx) => (
                <tr key={`${line.label}-${idx}`} className="border-0">
                  <td className="px-1.5 py-1.5 pr-2 align-top">{line.label}</td>
                  <td className="py-1.5 text-right tabular-nums align-top">{money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex justify-end">
          <div className="w-20 border-t border-neutral-300" aria-hidden />
        </div>
        <div className="mt-1.5 flex flex-col items-end gap-1.5 text-2xs">
          <div className="flex w-[220px] max-w-full justify-between gap-4">
            <span className="text-black">Gross pay:</span>
            <span className="tabular-nums text-right text-black">{money(payslip.grossPay)}</span>
          </div>
          {deductionLines.map((line) => (
            <div key={line.label} className="flex w-[220px] max-w-full justify-between gap-4">
              <span className="text-black">{line.label}:</span>
              <span className="tabular-nums text-right text-black">-{money(line.amount)}</span>
            </div>
          ))}
          {postTaxLines.map((line) => (
            <div key={line.label} className="flex w-[220px] max-w-full justify-between gap-4">
              <span className="text-black">{line.label}:</span>
              <span className="tabular-nums text-right text-black">+{money(line.amount)}</span>
            </div>
          ))}
          <div className="flex w-[220px] max-w-full justify-between gap-4 text-mini font-bold">
            <span className="text-black">NET PAY:</span>
            <span className="tabular-nums text-right text-black">{money(payslip.netPay)}</span>
          </div>
        </div>

        {payslip.bankLast4 ? (
          <p className="mt-6 text-2xs" style={{ color: 'rgb(100, 100, 100)' }}>
            Bank account ending ···· {payslip.bankLast4}
          </p>
        ) : null}

        <div
          className="mt-10 flex justify-between text-[8px] leading-none"
          style={{ color: 'rgb(150, 150, 150)' }}
        >
          <span>Generated by Yannis · {formatPayslipTimestamp()}</span>
          <span>Page 1 of 1</span>
        </div>
      </div>
    </div>
  );
}

export function PayslipDocumentPreview({ payslip }: { payslip: PayslipPdfInput }) {
  return <PdfLikePayslip payslip={payslip} />;
}
