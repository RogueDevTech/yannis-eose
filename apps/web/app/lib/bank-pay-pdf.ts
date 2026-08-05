import jsPDF from 'jspdf';
import { formatNaira as formatNairaAmount } from './format-amount';
import { INVOICE_LOGO_SRC, loadInvoiceLogoForPdf } from './invoice-pdf';

export { INVOICE_LOGO_SRC };

const FONT_FAMILY = 'NotoSans';
const FONT_REGULAR = '/fonts/NotoSans-Regular.ttf';
const FONT_BOLD = '/fonts/NotoSans-Bold.ttf';

let fontBase64: { regular: string; bold: string } | null = null;
let fontLoadFailed = false;
let fontInflight: Promise<{ regular: string; bold: string } | null> | null = null;

const NAIRA_CHAR = '\u20A6';

function uint8ToBase64(u8: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      u8.subarray(i, Math.min(i + chunk, u8.length)) as unknown as number[],
    );
  }
  return btoa(binary);
}

async function getFontBase64s(): Promise<{ regular: string; bold: string } | null> {
  if (fontBase64) return fontBase64;
  if (fontLoadFailed) return null;
  if (typeof fetch === 'undefined') {
    fontLoadFailed = true;
    return null;
  }
  if (!fontInflight) {
    fontInflight = (async () => {
      try {
        const [rReg, rBold] = await Promise.all([fetch(FONT_REGULAR), fetch(FONT_BOLD)]);
        if (!rReg.ok || !rBold.ok) {
          fontLoadFailed = true;
          return null;
        }
        const [bufReg, bufBold] = await Promise.all([rReg.arrayBuffer(), rBold.arrayBuffer()]);
        fontBase64 = {
          regular: uint8ToBase64(new Uint8Array(bufReg)),
          bold: uint8ToBase64(new Uint8Array(bufBold)),
        };
        return fontBase64;
      } catch {
        fontLoadFailed = true;
        return null;
      }
    })();
  }
  return fontInflight;
}

async function ensureEmbeddedFonts(doc: jsPDF): Promise<boolean> {
  const b64 = await getFontBase64s();
  if (!b64) return false;
  doc.addFileToVFS('NotoSans-Regular.ttf', b64.regular);
  doc.addFont('NotoSans-Regular.ttf', FONT_FAMILY, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', b64.bold);
  doc.addFont('NotoSans-Bold.ttf', FONT_FAMILY, 'bold');
  return true;
}

function formatNairaPdf(amount: number, useUnicodeNaira: boolean): string {
  const s = formatNairaAmount(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (useUnicodeNaira) return s;
  return s.replaceAll(NAIRA_CHAR, 'NGN ');
}

export type BankPayLine = {
  beneficiaryName: string;
  accountNumber: string;
  bankCode: string;
  bankName: string;
  amount: number;
  // Bank-upload narration (5-47 chars). Older payloads may still send `reference`.
  narration?: string;
  reference?: string;
  staffName?: string | null;
  payRoleName?: string | null;
};

// Narration is the current field; `reference` is the legacy name. Prefer narration.
export function bankPayNarration(row: BankPayLine): string {
  return row.narration || row.reference || '';
}

export type BankPayBatchSection = {
  batchId: string;
  // Null for null-scope batches (contractors / ALL) — rendered as a scope label.
  branchName: string | null;
  periodMonth: string;
  department: string | null;
  scopeType?: string | null;
  status?: string;
  rows: BankPayLine[];
};

export type BankPayPdfInput = {
  title?: string;
  generatedAt?: string;
  batches: BankPayBatchSection[];
};

export function formatBankPayPeriod(month: string): string {
  const d = new Date(month);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function bankPayGrandTotal(input: BankPayPdfInput): number {
  return input.batches.reduce(
    (sum, b) => sum + b.rows.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0),
    0,
  );
}

async function buildBankPayPdf(input: BankPayPdfInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'landscape' });
  const fontsOk = await ensureEmbeddedFonts(doc);
  const ff = fontsOk ? FONT_FAMILY : 'helvetica';
  const naira = (amount: number) => formatNairaPdf(amount, fontsOk);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = margin;

  const logo = await loadInvoiceLogoForPdf();

  const ensureSpace = (need: number) => {
    if (y + need > pageHeight - 16) {
      doc.addPage();
      y = margin;
    }
  };

  const drawHeader = () => {
    doc.setFontSize(18);
    doc.setFont(ff, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(input.title ?? 'BANK PAY LIST', margin, y + 4);

    if (logo) {
      const logoH = 8;
      const logoW = logoH * logo.aspect;
      doc.addImage(logo.dataUrl, 'PNG', pageWidth - margin - logoW, y - 2, logoW, logoH);
    }

    y += 12;
    doc.setFontSize(9);
    doc.setFont(ff, 'normal');
    doc.setTextColor(100, 100, 100);
    const generated = input.generatedAt
      ? new Date(input.generatedAt).toLocaleString('en-NG', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : new Date().toLocaleString('en-NG', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
    doc.text(`Generated: ${generated}`, margin, y);
    y += 5;
    doc.text(
      `Batches: ${input.batches.length} · Total: ${naira(bankPayGrandTotal(input))}`,
      margin,
      y,
    );
    y += 8;
  };

  drawHeader();

  const col = {
    name: margin,
    bank: margin + 48,
    code: margin + 88,
    account: margin + 118,
    amount: margin + 158,
    ref: margin + 192,
  };

  for (const batch of input.batches) {
    ensureSpace(28);
    doc.setFont(ff, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    const period = formatBankPayPeriod(batch.periodMonth);
    // Null-scope batches (contractors / ALL) have no department/branch.
    const deptLabel =
      batch.department ??
      (batch.scopeType === 'CONTRACTORS'
        ? 'Contractors'
        : batch.scopeType === 'ALL'
          ? 'All staff & contractors'
          : 'Payroll');
    const branchLabel = batch.branchName ?? 'Org-wide';
    doc.text(`${deptLabel} · ${period} · ${branchLabel}`, margin, y);
    y += 6;

    doc.setFillColor(245, 245, 245);
    doc.rect(margin, y - 3.5, pageWidth - 2 * margin, 7, 'F');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text('Account name', col.name, y);
    doc.text('Bank', col.bank, y);
    doc.text('Bank code', col.code, y);
    doc.text('Account number', col.account, y);
    doc.text('Amount', col.amount + 26, y, { align: 'right' });
    doc.text('Narration', col.ref, y);
    y += 6;

    doc.setFont(ff, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);

    let batchTotal = 0;
    for (const row of batch.rows) {
      ensureSpace(8);
      const name = (row.beneficiaryName || row.staffName || 'Unknown').slice(0, 26);
      const bank = (row.bankName || 'N/A').slice(0, 18);
      const code = (row.bankCode || 'N/A').slice(0, 12);
      const acct = (row.accountNumber || 'N/A').slice(0, 16);
      const ref = bankPayNarration(row).slice(0, 47);
      doc.text(name, col.name, y);
      doc.text(bank, col.bank, y);
      doc.setFont(ff, 'bold');
      doc.text(code, col.code, y);
      doc.setFont(ff, 'normal');
      doc.text(acct, col.account, y);
      doc.text(naira(row.amount), col.amount + 26, y, { align: 'right' });
      doc.text(ref, col.ref, y);
      batchTotal += row.amount;
      y += 5.5;
    }

    ensureSpace(10);
    doc.setFont(ff, 'bold');
    doc.text(`Batch total: ${naira(batchTotal)} · ${batch.rows.length} line(s)`, margin, y);
    y += 10;
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont(ff, 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text('Generated by Yannis', margin, pageHeight - 8);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  return doc;
}

export async function generateBankPayPdf(input: BankPayPdfInput): Promise<Blob> {
  const doc = await buildBankPayPdf(input);
  return doc.output('blob');
}

export async function downloadBankPayPdf(input: BankPayPdfInput, filename: string): Promise<void> {
  const blob = await generateBankPayPdf(input);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function generateBankPayPdfBytes(input: BankPayPdfInput): Promise<Uint8Array> {
  const doc = await buildBankPayPdf(input);
  const ab = doc.output('arraybuffer');
  return new Uint8Array(ab);
}
