import {
  INVOICE_LOGO_SRC,
  toInvoicePdfData,
  type InvoicePdfData,
  type InvoicePdfRowSource,
} from '~/lib/invoice-pdf';
import { formatNaira } from '~/lib/format-amount';

function PdfLikeInvoice({ invoice }: { invoice: InvoicePdfData }) {
  const taxRate = Number(invoice.taxRate ?? 0);
  const subtotal = invoice.lineItems.reduce(
    (sum, li) => sum + li.quantity * Number(li.unitPrice || 0),
    0,
  );
  const taxAmount = taxRate > 0 ? subtotal * taxRate : 0;
  const dateStr = (iso: string) =>
    new Date(iso).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div
      className="mx-auto max-w-[210mm] bg-white text-black shadow-sm border border-neutral-200"
      style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}
    >
      <div className="px-5 pt-5 pb-6 sm:px-[20px] sm:pt-5 sm:pb-8">
        {/* Header — matches jsPDF: INVOICE left; logo right (replaces Yannis wordmark) */}
        <div className="flex items-end justify-between gap-4">
          <h1 className="min-w-0 text-[24px] font-bold leading-none tracking-tight">INVOICE</h1>
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

        {/* Reference */}
        <div className="mt-3">
          <p className="text-[11px] font-bold leading-tight">{invoice.referenceFormatted}</p>
        </div>

        {/* Dates — PDF labels "Date:" / "Due:" */}
        <div className="mt-2 space-y-1 text-[9px] leading-snug" style={{ color: 'rgb(100, 100, 100)' }}>
          <p>Date: {dateStr(invoice.createdAt)}</p>
          {invoice.dueDate ? <p>Due: {dateStr(invoice.dueDate)}</p> : null}
        </div>

        {/* BILL TO */}
        <div className="mt-6">
          <p className="text-[9px] font-bold uppercase tracking-normal" style={{ color: 'rgb(100, 100, 100)' }}>
            BILL TO
          </p>
          <p className="mt-1 text-[10px] font-normal leading-snug text-black">{invoice.recipientInfo.name?.trim() || '—'}</p>
          {invoice.recipientInfo.address ? (
            <p className="mt-1 text-[9px] leading-snug text-black whitespace-pre-wrap">{invoice.recipientInfo.address}</p>
          ) : null}
          {invoice.recipientInfo.email ? (
            <p className="mt-1 text-[9px] leading-snug text-black">{invoice.recipientInfo.email}</p>
          ) : null}
          {invoice.recipientInfo.phone ? (
            <p className="mt-1 text-[9px] leading-snug text-black">{invoice.recipientInfo.phone}</p>
          ) : null}
        </div>

        {/* Line items table — PDF grey header #f5f5f5, labels Description / Qty / Unit Price / Amount */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-[9px]">
            <thead>
              <tr style={{ backgroundColor: 'rgb(245, 245, 245)' }}>
                <th className="px-1.5 py-2 text-left font-bold align-bottom" style={{ color: 'rgb(80, 80, 80)' }}>
                  Description
                </th>
                <th className="w-10 px-1 py-2 text-right font-bold align-bottom" style={{ color: 'rgb(80, 80, 80)' }}>
                  Qty
                </th>
                <th className="w-[72px] px-1 py-2 text-right font-bold align-bottom" style={{ color: 'rgb(80, 80, 80)' }}>
                  Unit Price
                </th>
                <th className="w-[72px] px-1 py-2 text-right font-bold align-bottom" style={{ color: 'rgb(80, 80, 80)' }}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="text-black">
              {invoice.lineItems.map((li, idx) => {
                const lineTotal = li.quantity * Number(li.unitPrice || 0);
                return (
                  <tr key={`${li.description}-${idx}`} className="border-0">
                    <td className="px-1.5 py-1.5 pr-2 align-top">{li.description}</td>
                    <td className="py-1.5 text-right tabular-nums align-top">{li.quantity}</td>
                    <td className="py-1.5 text-right tabular-nums align-top">
                      {formatNaira(Number(li.unitPrice), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-1.5 text-right tabular-nums align-top">
                      {formatNaira(lineTotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Separator + totals — PDF: short line top-right, then Subtotal/Tax/TOTAL right block */}
        <div className="mt-2 flex justify-end">
          <div className="w-20 border-t border-neutral-300" aria-hidden />
        </div>
        <div className="mt-1.5 flex flex-col items-end gap-1.5 text-[9px]">
          <div className="flex w-[200px] max-w-full justify-between gap-4">
            <span className="text-black">Subtotal:</span>
            <span className="tabular-nums text-right text-black">
              {formatNaira(subtotal, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          {taxRate > 0 ? (
            <div className="flex w-[200px] max-w-full justify-between gap-4">
              <span className="text-black">Tax ({(taxRate * 100).toFixed(1)}%):</span>
              <span className="tabular-nums text-right text-black">
                {formatNaira(taxAmount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          ) : null}
          <div className="flex w-[200px] max-w-full justify-between gap-4 text-[11px] font-bold">
            <span className="text-black">TOTAL:</span>
            <span className="tabular-nums text-right text-black">
              {formatNaira(Number(invoice.totalAmount), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Footer — PDF: Generated by Yannis left, Page 1 of N right */}
        <div className="mt-10 flex justify-between text-[8px] leading-none" style={{ color: 'rgb(150, 150, 150)' }}>
          <span>Generated by Yannis</span>
          <span>Page 1 of 1</span>
        </div>
      </div>
    </div>
  );
}

/**
 * On-screen invoice — layout and typography aligned to `buildInvoicePdf` in `invoice-pdf.ts`.
 */
export function InvoiceDocumentPreview({ invoice }: { invoice: InvoicePdfRowSource }) {
  const data = toInvoicePdfData(invoice);
  return <PdfLikeInvoice invoice={data} />;
}
