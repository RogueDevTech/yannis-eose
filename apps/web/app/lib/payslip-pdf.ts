import jsPDF from 'jspdf';
import { formatNaira as formatNairaAmount } from './format-amount';
import { INVOICE_LOGO_SRC, loadInvoiceLogoForPdf } from './invoice-pdf';

/** Re-export so payslip preview can use the same logo asset as invoices. */
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

export interface PayslipPdfLine {
  label: string;
  amount: number;
  /** When true, amount is shown as a deduction (still positive number in data). */
  deduction?: boolean;
}

export interface PayslipPdfInput {
  companyName?: string;
  periodLabel: string;
  /** Optional reference line under the title (e.g. payout id short form). */
  reference?: string;
  /**
   * Document date shown as "Date:" (paid / disbursed / issued).
   * ISO string; formatted like invoices.
   */
  issuedAt?: string;
  /** Optional label override for issuedAt (default "Date"). */
  issuedAtLabel?: string;
  employeeName: string;
  employeeId?: string;
  roleName?: string;
  department?: string;
  branchName?: string;
  baseSalary: number;
  performanceBonus: number;
  allowancesTotal: number;
  addOnsTotal: number;
  deductionsTotal: number;
  grossPay: number;
  payeTax: number;
  netPay: number;
  bankLast4?: string;
  bonusLines?: Array<{ label: string; amount: number }>;
  /** Period month ISO date used for the "Period:" line. */
  periodMonth?: string;
}

export function formatPayslipDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatPayslipTimestamp(iso: string = new Date().toISOString()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Normalized lines for PDF + HTML preview (single source of truth). */
export function buildPayslipLines(input: PayslipPdfInput): {
  earningLines: PayslipPdfLine[];
  deductionLines: PayslipPdfLine[];
} {
  const earningLines: PayslipPdfLine[] = [{ label: 'Base salary', amount: input.baseSalary }];
  if (input.performanceBonus > 0) {
    earningLines.push({ label: 'Performance bonus', amount: input.performanceBonus });
  }
  for (const line of input.bonusLines ?? []) {
    if (line.amount > 0) earningLines.push({ label: line.label, amount: line.amount });
  }
  if (input.allowancesTotal > 0) {
    earningLines.push({ label: 'Allowances', amount: input.allowancesTotal });
  }
  if (input.addOnsTotal > 0) {
    earningLines.push({ label: 'Add-ons', amount: input.addOnsTotal });
  }

  const deductionLines: PayslipPdfLine[] = [];
  if (input.payeTax > 0) {
    deductionLines.push({ label: 'PAYE tax', amount: input.payeTax, deduction: true });
  }
  if (input.deductionsTotal > 0) {
    deductionLines.push({ label: 'Other deductions', amount: input.deductionsTotal, deduction: true });
  }

  return { earningLines, deductionLines };
}

async function buildPayslipPdf(input: PayslipPdfInput): Promise<jsPDF> {
  const doc = new jsPDF();
  const fontsOk = await ensureEmbeddedFonts(doc);
  const ff = fontsOk ? FONT_FAMILY : 'helvetica';
  const naira = (amount: number) => formatNairaPdf(amount, fontsOk);

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = margin;

  const logo = await loadInvoiceLogoForPdf();
  const headerBaseline = margin;

  doc.setFontSize(24);
  doc.setFont(ff, 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('PAYSLIP', margin, headerBaseline);

  if (logo) {
    const logoH = 9;
    const logoW = logoH * logo.aspect;
    const logoTop = headerBaseline - logoH + 1.5;
    const logoX = pageWidth - margin - logoW;
    doc.addImage(logo.dataUrl, 'PNG', logoX, logoTop, logoW, logoH);
  } else {
    doc.setFontSize(11);
    doc.setFont(ff, 'bold');
    doc.setTextColor(55, 65, 81);
    doc.text(input.companyName ?? 'Yannis', pageWidth - margin, headerBaseline, { align: 'right' });
  }
  y += 12;

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont(ff, 'bold');
  doc.text(input.periodLabel, margin, y);
  y += 8;

  if (input.reference) {
    doc.setFontSize(9);
    doc.setFont(ff, 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(input.reference, margin, y);
    y += 6;
  }

  doc.setFontSize(9);
  doc.setFont(ff, 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Period: ${input.periodLabel}`, margin, y);
  if (input.issuedAt) {
    y += 5;
    const dateLabel = input.issuedAtLabel ?? 'Date';
    doc.text(`${dateLabel}: ${formatPayslipDate(input.issuedAt)}`, margin, y);
  }
  y += 10;

  // ── Employee ──
  doc.setFontSize(9);
  doc.setFont(ff, 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('EMPLOYEE', margin, y);
  y += 5;
  doc.setFont(ff, 'normal');
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.text(input.employeeName, margin, y);
  y += 5;
  doc.setFontSize(9);
  if (input.roleName) {
    doc.text(input.roleName, margin, y);
    y += 5;
  }
  if (input.department) {
    doc.text(input.department, margin, y);
    y += 5;
  }
  if (input.branchName) {
    doc.text(input.branchName, margin, y);
    y += 5;
  }
  if (input.employeeId) {
    doc.setTextColor(100, 100, 100);
    doc.text(`ID: ${input.employeeId}`, margin, y);
    y += 5;
    doc.setTextColor(0, 0, 0);
  }
  y += 8;

  const { earningLines, deductionLines } = buildPayslipLines(input);
  const colLabel = margin;
  const colAmount = pageWidth - margin;

  // Table header
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y - 4, pageWidth - 2 * margin, 8, 'F');
  doc.setFontSize(8);
  doc.setFont(ff, 'bold');
  doc.setTextColor(80, 80, 80);
  doc.text('Description', colLabel + 3, y);
  doc.text('Amount', colAmount, y, { align: 'right' });
  y += 7;

  doc.setFont(ff, 'normal');
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);

  for (const line of earningLines) {
    doc.text(line.label, colLabel + 3, y);
    doc.text(naira(line.amount), colAmount, y, { align: 'right' });
    y += 6;
    if (y > 260) {
      doc.addPage();
      y = margin;
    }
  }

  y += 2;
  doc.setDrawColor(200, 200, 200);
  doc.line(pageWidth - margin - 80, y, pageWidth - margin, y);
  y += 6;

  doc.setFontSize(9);
  doc.setFont(ff, 'normal');
  doc.text('Gross pay:', pageWidth - margin - 55, y);
  doc.text(naira(input.grossPay), pageWidth - margin, y, { align: 'right' });
  y += 6;

  for (const line of deductionLines) {
    doc.text(`${line.label}:`, pageWidth - margin - 55, y);
    doc.text(`-${naira(line.amount)}`, pageWidth - margin, y, { align: 'right' });
    y += 6;
  }

  doc.setFont(ff, 'bold');
  doc.setFontSize(11);
  doc.text('NET PAY:', pageWidth - margin - 55, y);
  doc.text(naira(input.netPay), pageWidth - margin, y, { align: 'right' });
  y += 12;

  if (input.bankLast4) {
    doc.setFont(ff, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Bank account ending ···· ${input.bankLast4}`, margin, y);
  }

  doc.setFontSize(8);
  doc.setFont(ff, 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated by Yannis · ${formatPayslipTimestamp()}`, margin, 280);
  doc.text(`Page 1 of ${doc.getNumberOfPages()}`, pageWidth - margin, 280, { align: 'right' });

  return doc;
}

export async function generatePayslipPdf(input: PayslipPdfInput): Promise<Blob> {
  const doc = await buildPayslipPdf(input);
  return doc.output('blob');
}

export function downloadPayslipPdf(input: PayslipPdfInput, filename: string): Promise<void> {
  return generatePayslipPdf(input).then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
}
