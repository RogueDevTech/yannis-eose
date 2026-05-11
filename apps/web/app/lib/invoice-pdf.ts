import jsPDF from 'jspdf';
import type { Invoice } from '~/features/finance/types';
import type { OrderInvoice } from '~/features/orders/types';
import { formatNaira as formatNairaAmount } from './format-amount';

/** jsPDF built-ins (Helvetica) omit U+20A6 (₦); register Noto Sans so currency renders correctly. */
const INVOICE_PDF_FONT_FAMILY = 'NotoSans';
const INVOICE_PDF_FONT_REGULAR = '/fonts/NotoSans-Regular.ttf';
const INVOICE_PDF_FONT_BOLD = '/fonts/NotoSans-Bold.ttf';

let invoicePdfFontBase64: { regular: string; bold: string } | null = null;
let invoicePdfFontLoadFailed = false;
let invoicePdfFontInflight: Promise<{ regular: string; bold: string } | null> | null = null;

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

async function getInvoicePdfFontBase64s(): Promise<{ regular: string; bold: string } | null> {
  if (invoicePdfFontBase64) return invoicePdfFontBase64;
  if (invoicePdfFontLoadFailed) return null;
  if (typeof fetch === 'undefined') {
    invoicePdfFontLoadFailed = true;
    return null;
  }
  if (!invoicePdfFontInflight) {
    invoicePdfFontInflight = (async () => {
      try {
        const [rReg, rBold] = await Promise.all([
          fetch(INVOICE_PDF_FONT_REGULAR),
          fetch(INVOICE_PDF_FONT_BOLD),
        ]);
        if (!rReg.ok || !rBold.ok) {
          invoicePdfFontLoadFailed = true;
          return null;
        }
        const [bufReg, bufBold] = await Promise.all([rReg.arrayBuffer(), rBold.arrayBuffer()]);
        const regular = uint8ToBase64(new Uint8Array(bufReg));
        const bold = uint8ToBase64(new Uint8Array(bufBold));
        invoicePdfFontBase64 = { regular, bold };
        return invoicePdfFontBase64;
      } catch {
        invoicePdfFontLoadFailed = true;
        return null;
      }
    })();
  }
  return invoicePdfFontInflight;
}

async function ensureInvoicePdfEmbeddedFonts(doc: jsPDF): Promise<boolean> {
  const b64 = await getInvoicePdfFontBase64s();
  if (!b64) return false;
  doc.addFileToVFS('NotoSans-Regular.ttf', b64.regular);
  doc.addFont('NotoSans-Regular.ttf', INVOICE_PDF_FONT_FAMILY, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', b64.bold);
  doc.addFont('NotoSans-Bold.ttf', INVOICE_PDF_FONT_FAMILY, 'bold');
  return true;
}

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: string;
}

/** Normalized payload for jsPDF rendering (API rows should pass through `toInvoicePdfData` first). */
export interface InvoicePdfData {
  referenceFormatted: string;
  recipientInfo: {
    name: string;
    address?: string;
    email?: string;
    phone?: string;
  };
  lineItems: LineItem[];
  taxRate: string | null;
  totalAmount: string;
  status: string;
  dueDate: string | null;
  createdAt: string;
  /** When true, render a rubber-stamp "MARKED AS PAID" at bottom-right (HTML + PDF). */
  markedPaid?: boolean;
}

/** Order-detail or Finance list rows — single choke point if API shapes diverge later. */
export type InvoicePdfRowSource = OrderInvoice | Invoice;

/** Public path to invoice header logo — white-friendly asset for PDF / preview paper. */
export const INVOICE_LOGO_SRC = '/assets/yannis-logo-white-bg.png';

interface LogoForPdf {
  dataUrl: string;
  aspect: number;
}

interface PaidStampForPdf {
  dataUrl: string;
  aspect: number;
}

let paidStampPdfImage: PaidStampForPdf | null = null;
let paidStampPdfInflight: Promise<PaidStampForPdf | null> | null = null;

/**
 * Loads the PNG logo in the browser for embedding in jsPDF. Returns null on
 * failure or when not in a browser (SSR).
 */
function loadInvoiceLogoForPdf(): Promise<LogoForPdf | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
          resolve(null);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL('image/png'), aspect: w / h });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = INVOICE_LOGO_SRC;
  });
}

/**
 * Render the exact rubber-stamp look as an offscreen image for jsPDF.
 *
 * Root cause:
 * The modal preview uses browser text/layout (Courier + rotation + border),
 * while the old PDF path redrew the stamp using jsPDF text metrics and a fixed
 * rectangle. Those two renderers do not shape text the same way, which is why
 * the download looked distorted even when the modal preview was fine.
 *
 * Fix:
 * Let the browser render the stamp once, then embed that result as an image in
 * the PDF. This keeps the original design while removing jsPDF font-metric
 * drift from the equation.
 */
function loadPaidStampForPdf(): Promise<PaidStampForPdf | null> {
  if (paidStampPdfImage) return Promise.resolve(paidStampPdfImage);
  if (paidStampPdfInflight) return paidStampPdfInflight;
  if (typeof window === 'undefined' || typeof Image === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  paidStampPdfInflight = new Promise((resolve) => {
    const svgW = 380;
    const svgH = 180;
    const ink = '#15803d';
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
        <g transform="rotate(-12 ${svgW / 2} ${svgH / 2})" opacity="0.85">
          <rect x="34" y="58" width="312" height="58" rx="6" ry="6"
            fill="none" stroke="${ink}" stroke-width="6" />
          <rect x="40" y="64" width="300" height="46" rx="4" ry="4"
            fill="none" stroke="${ink}" stroke-width="2" />
          <text
            x="${svgW / 2}"
            y="${svgH / 2 + 2}"
            text-anchor="middle"
            dominant-baseline="middle"
            fill="${ink}"
            font-family="'Courier New', Courier, monospace"
            font-size="30"
            font-weight="800"
            letter-spacing="2.2"
          >MARKED AS PAID</text>
        </g>
      </svg>
    `.trim();

    const img = new Image();
    img.onload = () => {
      try {
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = svgW * scale;
        canvas.height = svgH * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, svgW, svgH);
        paidStampPdfImage = {
          dataUrl: canvas.toDataURL('image/png'),
          aspect: svgW / svgH,
        };
        resolve(paidStampPdfImage);
      } catch {
        resolve(null);
      } finally {
        paidStampPdfInflight = null;
      }
    };
    img.onerror = () => {
      paidStampPdfInflight = null;
      resolve(null);
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

  return paidStampPdfInflight;
}

/**
 * Maps finance/order invoice API rows into the PDF renderer input.
 * Call from any surface that triggers `generateInvoicePdf` or the HTML preview (`InvoiceDocumentPreview`).
 */
export function toInvoicePdfData(row: InvoicePdfRowSource): InvoicePdfData {
  const ri = row.recipientInfo;
  return {
    referenceFormatted: row.referenceFormatted,
    recipientInfo: {
      name: typeof ri?.name === 'string' ? ri.name : '',
      address: ri?.address,
      email: ri?.email,
      phone: ri?.phone,
    },
    lineItems: row.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: String(li.unitPrice),
    })),
    taxRate: row.taxRate,
    totalAmount: row.totalAmount,
    status: row.status,
    dueDate: row.dueDate,
    createdAt: row.createdAt,
    // `markedPaid` is on `OrderInvoice` (server-derived from
    // `delivery_remittances.status === 'RECEIVED'`), absent on `Invoice`.
    // Pass through when present; otherwise downstream renderers leave the stamp off.
    ...('markedPaid' in row && row.markedPaid ? { markedPaid: true } : {}),
  };
}

async function buildInvoicePdf(invoice: InvoicePdfData): Promise<jsPDF> {
  const doc = new jsPDF();
  const fontsOk = await ensureInvoicePdfEmbeddedFonts(doc);
  const ff = fontsOk ? INVOICE_PDF_FONT_FAMILY : 'helvetica';
  const naira = (amount: number) => formatNairaPdf(amount, fontsOk);

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = margin;

  // ── Header: INVOICE left; logo right (replaces “Yannis” wordmark when loaded) ──
  const [logo, paidStamp] = await Promise.all([
    loadInvoiceLogoForPdf(),
    invoice.markedPaid ? loadPaidStampForPdf() : Promise.resolve(null),
  ]);
  const headerBaseline = margin;

  doc.setFontSize(24);
  doc.setFont(ff, 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('INVOICE', margin, headerBaseline);

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

  // ── Reference & Status ────────────────────
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont(ff, 'bold');
  doc.text(invoice.referenceFormatted, margin, y);
  y += 8;

  // ── Dates ─────────────────────────────────
  doc.setFontSize(9);
  doc.setFont(ff, 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(
    `Date: ${new Date(invoice.createdAt).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    margin,
    y,
  );
  if (invoice.dueDate) {
    y += 5;
    doc.text(
      `Due: ${new Date(invoice.dueDate).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      margin,
      y,
    );
  }
  y += 10;

  // ── Recipient ─────────────────────────────
  doc.setFontSize(9);
  doc.setFont(ff, 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('BILL TO', margin, y);
  y += 5;
  doc.setFont(ff, 'normal');
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.text(invoice.recipientInfo.name, margin, y);
  if (invoice.recipientInfo.address) {
    y += 5;
    doc.setFontSize(9);
    doc.text(invoice.recipientInfo.address, margin, y);
  }
  if (invoice.recipientInfo.email) {
    y += 5;
    doc.setFontSize(9);
    doc.text(invoice.recipientInfo.email, margin, y);
  }
  if (invoice.recipientInfo.phone) {
    y += 5;
    doc.setFontSize(9);
    doc.text(invoice.recipientInfo.phone, margin, y);
  }
  y += 12;

  // ── Line Items Table ──────────────────────
  const colX = {
    desc: margin,
    qty: pageWidth - margin - 70,
    unitPrice: pageWidth - margin - 42,
    total: pageWidth - margin,
  };

  // Table header
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y - 4, pageWidth - 2 * margin, 8, 'F');
  doc.setFontSize(8);
  doc.setFont(ff, 'bold');
  doc.setTextColor(80, 80, 80);
  doc.text('Description', colX.desc + 3, y);
  doc.text('Qty', colX.qty, y, { align: 'right' });
  doc.text('Unit Price', colX.unitPrice, y, { align: 'right' });
  doc.text('Amount', colX.total, y, { align: 'right' });
  y += 7;

  // Table rows
  doc.setFont(ff, 'normal');
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);

  let subtotal = 0;
  for (const item of invoice.lineItems) {
    const lineTotal = item.quantity * Number(item.unitPrice);
    subtotal += lineTotal;

    doc.text(item.description, colX.desc + 3, y);
    doc.text(String(item.quantity), colX.qty, y, { align: 'right' });
    doc.text(naira(Number(item.unitPrice)), colX.unitPrice, y, { align: 'right' });
    doc.text(naira(lineTotal), colX.total, y, { align: 'right' });
    y += 6;

    // Add page break if needed
    if (y > 260) {
      doc.addPage();
      y = margin;
    }
  }

  // ── Separator line ────────────────────────
  y += 2;
  doc.setDrawColor(200, 200, 200);
  doc.line(pageWidth - margin - 80, y, pageWidth - margin, y);
  y += 6;

  // ── Subtotal ──────────────────────────────
  doc.setFontSize(9);
  doc.setFont(ff, 'normal');
  doc.text('Subtotal:', pageWidth - margin - 55, y);
  doc.text(naira(subtotal), pageWidth - margin, y, { align: 'right' });
  y += 6;

  // Tax
  const taxRate = Number(invoice.taxRate ?? 0);
  if (taxRate > 0) {
    const taxAmount = subtotal * taxRate;
    doc.text(`Tax (${(taxRate * 100).toFixed(1)}%):`, pageWidth - margin - 55, y);
    doc.text(naira(taxAmount), pageWidth - margin, y, { align: 'right' });
    y += 6;
  }

  // Total
  doc.setFont(ff, 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL:', pageWidth - margin - 55, y);
  doc.text(naira(Number(invoice.totalAmount)), pageWidth - margin, y, { align: 'right' });
  y += 14;

  // ── Footer ────────────────────────────────
  doc.setFontSize(8);
  doc.setFont(ff, 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text('Generated by Yannis', margin, 280);
  doc.text(`Page 1 of ${doc.getNumberOfPages()}`, pageWidth - margin, 280, { align: 'right' });

  // ── "MARKED AS PAID" rubber stamp ─────────
  // Render after the invoice content, but above the footer, so it never covers
  // line items or totals. Mirrors the HTML preview layout.
  if (invoice.markedPaid) {
    drawPaidStamp(doc, ff, pageWidth, paidStamp, y);
  }

  return doc;
}

/**
 * Render the "MARKED AS PAID" rubber-stamp at the bottom-right corner of the
 * current page in the given jsPDF doc. Approximation of a real rubber-stamp:
 * rotated double rectangle border + bold uppercase text in green.
 *
 * Placement notes:
 * - A4 page is 210 × 297 mm. Footer text sits at y=280; bottom margin = 297-280 ≈ 17mm.
 * - We anchor the stamp at (pageWidth - 35, 260) — roughly 25mm from the right
 *   edge and 37mm from the bottom, leaving room for the rotated bounding box
 *   without overlapping the footer or running off the page.
 * - Text font is 14pt so the rendered string ("MARKED AS PAID") fits within
 *   the 70mm-wide border with comfortable padding (was 20pt + 60mm box, which
 *   had the text running outside the border).
 */
function drawPaidStamp(
  doc: jsPDF,
  fontFamily: string,
  pageWidth: number,
  paidStamp: PaidStampForPdf | null,
  contentBottomY: number,
): void {
  const y = Math.min(contentBottomY + 6, 228);
  if (paidStamp) {
    const w = 82;
    const h = w / paidStamp.aspect;
    const x = pageWidth - 22 - w;
    doc.addImage(paidStamp.dataUrl, 'PNG', x, y, w, h);
    return;
  }

  // Box dimensions (mm) and centre position (bottom-right, well clear of footer).
  const w = 70;
  const h = 14;
  const cx = pageWidth - 35; // 25mm right margin gives the rotated corners breathing room
  const cy = y + h / 2;
  const angle = -12; // degrees, matches HTML preview

  // Green-700 ink (matches HTML stamp `#15803d`).
  const ink: [number, number, number] = [21, 128, 61];
  doc.setDrawColor(ink[0], ink[1], ink[2]);
  doc.setTextColor(ink[0], ink[1], ink[2]);
  doc.setLineWidth(0.8);

  // Text — sized so the string fits inside the 70mm border with padding.
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(14);
  doc.text('MARKED AS PAID', cx, cy, { align: 'center', baseline: 'middle', angle });

  // Outer border — 4 lines stroked along the rotated box's perimeter.
  const halfW = w / 2;
  const halfH = h / 2;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corner = (sx: number, sy: number): [number, number] => [
    cx + sx * cos - sy * sin,
    cy + sx * sin + sy * cos,
  ];
  const tl = corner(-halfW, -halfH);
  const tr = corner(halfW, -halfH);
  const br = corner(halfW, halfH);
  const bl = corner(-halfW, halfH);
  doc.line(tl[0], tl[1], tr[0], tr[1]);
  doc.line(tr[0], tr[1], br[0], br[1]);
  doc.line(br[0], br[1], bl[0], bl[1]);
  doc.line(bl[0], bl[1], tl[0], tl[1]);

  // Inner border — offset 1.5mm in to read as a double-ring stamp.
  const innerHalfW = halfW - 1.5;
  const innerHalfH = halfH - 1.5;
  const itl = corner(-innerHalfW, -innerHalfH);
  const itr = corner(innerHalfW, -innerHalfH);
  const ibr = corner(innerHalfW, innerHalfH);
  const ibl = corner(-innerHalfW, innerHalfH);
  doc.setLineWidth(0.4);
  doc.line(itl[0], itl[1], itr[0], itr[1]);
  doc.line(itr[0], itr[1], ibr[0], ibr[1]);
  doc.line(ibr[0], ibr[1], ibl[0], ibl[1]);
  doc.line(ibl[0], ibl[1], itl[0], itl[1]);

  // Reset draw state so any callers downstream see a clean slate.
  doc.setDrawColor(0, 0, 0);
  doc.setTextColor(0, 0, 0);
  doc.setLineWidth(0.2);
}

/**
 * Build an invoice PDF and download it to disk.
 * For in-app preview use the `InvoiceDocumentPreview` React component.
 */
export async function generateInvoicePdf(invoice: InvoicePdfRowSource): Promise<void> {
  const doc = await buildInvoicePdf(toInvoicePdfData(invoice));
  doc.save(`${invoice.referenceFormatted}.pdf`);
}

const NAIRA_CHAR = '\u20A6';

function formatNairaPdf(amount: number, useUnicodeNaira: boolean): string {
  const s = formatNairaAmount(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (useUnicodeNaira) return s;
  return s.replaceAll(NAIRA_CHAR, 'NGN ');
}
