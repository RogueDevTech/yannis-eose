import jsPDF from 'jspdf';
import type { CashLedgerStatement } from '~/features/finance/cash-statement-types';
import { formatNaira as formatNairaAmount } from './format-amount';
import { loadInvoiceLogoForPdf } from './invoice-pdf';

/** Match invoice-pdf.ts NotoSans embedding so ₦ renders correctly. */
const FONT_FAMILY = 'NotoSans';
const FONT_REGULAR = '/fonts/NotoSans-Regular.ttf';
const FONT_BOLD = '/fonts/NotoSans-Bold.ttf';

let fontBase64: { regular: string; bold: string } | null = null;
let fontLoadFailed = false;
let fontInflight: Promise<{ regular: string; bold: string } | null> | null = null;

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

async function loadFonts(): Promise<{ regular: string; bold: string } | null> {
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

async function ensureFonts(doc: jsPDF): Promise<boolean> {
  const b64 = await loadFonts();
  if (!b64) return false;
  doc.addFileToVFS('NotoSans-Regular.ttf', b64.regular);
  doc.addFont('NotoSans-Regular.ttf', FONT_FAMILY, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', b64.bold);
  doc.addFont('NotoSans-Bold.ttf', FONT_FAMILY, 'bold');
  return true;
}

const NAIRA_CHAR = '\u20A6';

function formatNairaPdf(amount: number | string, useUnicodeNaira: boolean): string {
  const n = Number(amount) || 0;
  const s = formatNairaAmount(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (useUnicodeNaira) return s;
  return s.replaceAll(NAIRA_CHAR, 'NGN ');
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

const STATUS_LABEL: Record<string, string> = {
  SENT: 'Pending',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};

type Column = { label: string; width: number; align?: 'left' | 'right' };

function ensurePage(doc: jsPDF, y: number, margin: number, needed = 12): number {
  if (y + needed > 270) {
    doc.addPage();
    return margin;
  }
  return y;
}

function drawSectionTitle(doc: jsPDF, ff: string, label: string, y: number, margin: number): number {
  y = ensurePage(doc, y, margin, 12);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont(ff, 'bold');
  doc.text(label, margin, y);
  return y + 6;
}

function drawTableHeader(
  doc: jsPDF,
  ff: string,
  cols: Column[],
  y: number,
  margin: number,
  contentW: number,
): number {
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y - 1, contentW, 7, 'F');
  doc.setFontSize(8);
  doc.setFont(ff, 'bold');
  doc.setTextColor(55, 65, 81);
  let x = margin;
  for (const col of cols) {
    const tx = col.align === 'right' ? x + col.width - 1.5 : x + 1.5;
    doc.text(col.label, tx, y + 4, { align: col.align === 'right' ? 'right' : 'left' });
    x += col.width;
  }
  return y + 8;
}

function drawRow(
  doc: jsPDF,
  ff: string,
  cols: Column[],
  values: string[],
  y: number,
  margin: number,
): number {
  doc.setFontSize(8);
  doc.setFont(ff, 'normal');
  doc.setTextColor(0, 0, 0);
  let x = margin;
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!;
    const tx = col.align === 'right' ? x + col.width - 1.5 : x + 1.5;
    const text = values[i] ?? '';
    doc.text(text.length > 40 ? `${text.slice(0, 38)}…` : text, tx, y + 3.5, {
      align: col.align === 'right' ? 'right' : 'left',
    });
    x += col.width;
  }
  return y + 6;
}

function drawSummaryBlock(
  doc: jsPDF,
  ff: string,
  naira: (v: number | string) => string,
  summary: CashLedgerStatement['summary'],
  y: number,
  margin: number,
  pageWidth: number,
): number {
  y = drawSectionTitle(doc, ff, 'Summary', y, margin);
  const lines: Array<[string, string]> = [
    [`Awaiting cash (${summary.awaitingCount} orders)`, naira(summary.awaitingCash)],
    [`Pending remittances (${summary.pendingCount} orders)`, naira(summary.pendingCash)],
    [`Remitted (${summary.remittedCount} orders)`, naira(summary.remittedCash)],
    [`Disputed (${summary.disputedCount} orders)`, naira(summary.disputedCash)],
    ['Delivery fees', naira(summary.deliveryFees)],
    ['Batch fees (commitment / POS / failed / discount / waybill)', naira(summary.batchFeesTotal)],
    ['Net owed to Finance', naira(summary.netOwedToFinance)],
  ];
  for (const [label, value] of lines) {
    y = ensurePage(doc, y, margin, 6);
    const isNet = label.startsWith('Net owed');
    doc.setFontSize(9);
    doc.setFont(ff, isNet ? 'bold' : 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(label, margin, y);
    doc.text(value, pageWidth - margin, y, { align: 'right' });
    y += 5.5;
  }
  return y + 4;
}

function drawFooter(doc: jsPDF, ff: string, pageWidth: number, margin: number) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont(ff, 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text('Generated by Yannis', margin, 280);
    doc.text(`Page ${i} of ${pages}`, pageWidth - margin, 280, { align: 'right' });
  }
}

export async function generateCashStatementPdf(statement: CashLedgerStatement): Promise<jsPDF> {
  const doc = new jsPDF();
  const fontsOk = await ensureFonts(doc);
  const ff = fontsOk ? FONT_FAMILY : 'helvetica';
  const naira = (amount: number | string) => formatNairaPdf(amount, fontsOk);

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentW = pageWidth - margin * 2;
  let y = margin;

  const { header, summary } = statement;

  // Header: document title left; logo right (same pattern as invoice PDF).
  const logo = await loadInvoiceLogoForPdf();
  const headerBaseline = margin;

  doc.setFontSize(22);
  doc.setFont(ff, 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('CASH STATEMENT', margin, headerBaseline);

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
    doc.text('Yannis', pageWidth - margin, headerBaseline, { align: 'right' });
  }
  y += 12;

  // Meta block (partner / period), invoice-style left stack.
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont(ff, 'bold');
  const scopeLine =
    header.scope === 'location'
      ? `${header.providerName} · ${header.locationName ?? 'Location'}`
      : `${header.providerName} (all locations)`;
  doc.text(scopeLine, margin, y);
  y += 6;

  doc.setFontSize(9);
  doc.setFont(ff, 'normal');
  doc.setTextColor(100, 100, 100);
  const periodLine =
    header.startDate || header.endDate
      ? `Period: ${header.startDate ?? '…'} to ${header.endDate ?? '…'}`
      : 'Period: All time';
  doc.text(periodLine, margin, y);
  y += 5;
  doc.text(
    `Date scope: ${header.dateScope === 'deliveredAt' ? 'Delivery date' : 'Order date'}`,
    margin,
    y,
  );
  y += 5;
  doc.text(`Generated: ${fmtDate(header.generatedAt)}`, margin, y);
  y += 10;

  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  y = drawSummaryBlock(doc, ff, naira, summary, y, margin, pageWidth);

  for (const loc of statement.locations) {
    if (statement.locations.length > 1) {
      y = drawSectionTitle(doc, ff, `Location: ${loc.locationName}`, y, margin);
      y = drawSummaryBlock(doc, ff, naira, loc.summary, y, margin, pageWidth);
    }

    y = drawSectionTitle(doc, ff, 'Awaiting orders', y, margin);
    if (loc.awaitingOrders.length === 0) {
      doc.setFontSize(9);
      doc.setFont(ff, 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text('None in this period.', margin, y);
      y += 8;
    } else {
      const cols: Column[] = [
        { label: 'Order', width: 34 },
        { label: 'Delivered', width: 42 },
        { label: 'Gross', width: 34, align: 'right' },
        { label: 'Delivery fee', width: 34, align: 'right' },
        { label: 'Net', width: 26, align: 'right' },
      ];
      y = drawTableHeader(doc, ff, cols, y, margin, contentW);
      for (const o of loc.awaitingOrders) {
        y = ensurePage(doc, y, margin, 8);
        y = drawRow(
          doc,
          ff,
          cols,
          [
            o.orderRef || o.orderId.slice(0, 8),
            fmtDate(o.deliveredAt),
            naira(o.gross),
            naira(o.deliveryFee),
            naira(o.net),
          ],
          y,
          margin,
        );
      }
      y += 4;
    }

    y = drawSectionTitle(doc, ff, 'Remittance batches', y, margin);
    if (loc.batches.length === 0) {
      doc.setFontSize(9);
      doc.setFont(ff, 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text('None in this period.', margin, y);
      y += 8;
    } else {
      const cols: Column[] = [
        { label: 'Sent', width: 36 },
        { label: 'Status', width: 26 },
        { label: 'Orders', width: 18, align: 'right' },
        { label: 'Gross nets', width: 34, align: 'right' },
        { label: 'Batch fees', width: 32, align: 'right' },
        { label: 'Batch', width: 24 },
      ];
      y = drawTableHeader(doc, ff, cols, y, margin, contentW);
      for (const b of loc.batches) {
        y = ensurePage(doc, y, margin, 8);
        y = drawRow(
          doc,
          ff,
          cols,
          [
            fmtDate(b.sentAt),
            STATUS_LABEL[b.status] ?? b.status,
            String(b.orderCount),
            naira(b.grossNets),
            naira(b.batchFeesTotal),
            b.id.slice(0, 8),
          ],
          y,
          margin,
        );
      }
      y += 4;
    }

    if (loc.orderLines.length > 0) {
      y = drawSectionTitle(doc, ff, 'Remitted order lines', y, margin);
      const cols: Column[] = [
        { label: 'Order', width: 32 },
        { label: 'Batch', width: 28 },
        { label: 'Status', width: 26 },
        { label: 'Gross', width: 32, align: 'right' },
        { label: 'Fee', width: 28, align: 'right' },
        { label: 'Net', width: 24, align: 'right' },
      ];
      y = drawTableHeader(doc, ff, cols, y, margin, contentW);
      for (const line of loc.orderLines) {
        y = ensurePage(doc, y, margin, 8);
        y = drawRow(
          doc,
          ff,
          cols,
          [
            line.orderRef || line.orderId.slice(0, 8),
            line.remittanceId.slice(0, 8),
            STATUS_LABEL[line.remittanceStatus] ?? line.remittanceStatus,
            naira(line.gross),
            naira(line.deliveryFee),
            naira(line.net),
          ],
          y,
          margin,
        );
      }
      y += 4;
    }
  }

  drawFooter(doc, ff, pageWidth, margin);
  return doc;
}

export async function buildCashStatementPdfBlob(statement: CashLedgerStatement): Promise<Blob> {
  const doc = await generateCashStatementPdf(statement);
  return doc.output('blob');
}

export async function downloadCashStatementPdf(statement: CashLedgerStatement, filename: string) {
  const doc = await generateCashStatementPdf(statement);
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
