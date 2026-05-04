import jsPDF from 'jspdf';
import type { Invoice } from '~/features/finance/types';
import type { OrderInvoice } from '~/features/orders/types';
import { formatNaira as formatNairaAmount } from './format-amount';

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
}

/** Order-detail or Finance list rows — single choke point if API shapes diverge later. */
export type InvoicePdfRowSource = OrderInvoice | Invoice;

/**
 * Maps finance/order invoice API rows into the PDF renderer input.
 * Call from any surface that triggers `generateInvoicePdf` / `previewInvoicePdf`.
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
  };
}

type PdfMode = 'download' | 'preview';

function buildInvoicePdf(invoice: InvoicePdfData): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = margin;

  // ── Header ────────────────────────────────
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', margin, y);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text('Yannis EOSE', pageWidth - margin, y, { align: 'right' });
  y += 6;
  doc.text('Enterprise Operations & Sales Engine', pageWidth - margin, y, { align: 'right' });
  y += 12;

  // ── Reference & Status ────────────────────
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(invoice.referenceFormatted, margin, y);

  // Status badge
  const statusColors: Record<string, [number, number, number]> = {
    DRAFT: [234, 179, 8],
    SENT: [59, 130, 246],
    PAID: [34, 197, 94],
    OVERDUE: [239, 68, 68],
    CANCELLED: [107, 114, 128],
  };
  const statusColor = statusColors[invoice.status] ?? [107, 114, 128];
  doc.setFillColor(...statusColor);
  const statusText = invoice.status;
  const statusWidth = doc.getTextWidth(statusText) + 8;
  doc.roundedRect(pageWidth - margin - statusWidth, y - 5, statusWidth, 7, 1, 1, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(statusText, pageWidth - margin - statusWidth + 4, y - 0.5);

  y += 8;

  // ── Dates ─────────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Date: ${new Date(invoice.createdAt).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })}`, margin, y);
  if (invoice.dueDate) {
    y += 5;
    doc.text(`Due: ${new Date(invoice.dueDate).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })}`, margin, y);
  }
  y += 10;

  // ── Recipient ─────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('BILL TO', margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
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
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(80, 80, 80);
  doc.text('Description', colX.desc + 3, y);
  doc.text('Qty', colX.qty, y, { align: 'right' });
  doc.text('Unit Price', colX.unitPrice, y, { align: 'right' });
  doc.text('Amount', colX.total, y, { align: 'right' });
  y += 7;

  // Table rows
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);

  let subtotal = 0;
  for (const item of invoice.lineItems) {
    const lineTotal = item.quantity * Number(item.unitPrice);
    subtotal += lineTotal;

    doc.text(item.description, colX.desc + 3, y);
    doc.text(String(item.quantity), colX.qty, y, { align: 'right' });
    doc.text(formatNaira(Number(item.unitPrice)), colX.unitPrice, y, { align: 'right' });
    doc.text(formatNaira(lineTotal), colX.total, y, { align: 'right' });
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
  doc.setFont('helvetica', 'normal');
  doc.text('Subtotal:', pageWidth - margin - 55, y);
  doc.text(formatNaira(subtotal), pageWidth - margin, y, { align: 'right' });
  y += 6;

  // Tax
  const taxRate = Number(invoice.taxRate ?? 0);
  if (taxRate > 0) {
    const taxAmount = subtotal * taxRate;
    doc.text(`Tax (${(taxRate * 100).toFixed(1)}%):`, pageWidth - margin - 55, y);
    doc.text(formatNaira(taxAmount), pageWidth - margin, y, { align: 'right' });
    y += 6;
  }

  // Total
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL:', pageWidth - margin - 55, y);
  doc.text(formatNaira(Number(invoice.totalAmount)), pageWidth - margin, y, { align: 'right' });
  y += 14;

  // ── Footer ────────────────────────────────
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text('Generated by Yannis EOSE', margin, 280);
  doc.text(`Page 1 of ${doc.getNumberOfPages()}`, pageWidth - margin, 280, { align: 'right' });

  return doc;
}

/**
 * Build an invoice PDF and either download it or open it in a new tab for preview.
 * @param invoice — invoice data to render
 * @param mode — `'download'` triggers a save; `'preview'` opens the PDF in a new tab
 */
export function generateInvoicePdf(invoice: InvoicePdfRowSource, mode: PdfMode = 'download') {
  const doc = buildInvoicePdf(toInvoicePdfData(invoice));
  if (mode === 'preview') {
    const url = doc.output('bloburl');
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
    return;
  }
  doc.save(`${invoice.referenceFormatted}.pdf`);
}

/** Open the invoice PDF in a new tab without downloading. */
export function previewInvoicePdf(invoice: InvoicePdfRowSource) {
  generateInvoicePdf(invoice, 'preview');
}

function formatNaira(amount: number): string {
  return formatNairaAmount(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
