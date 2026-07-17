import jsPDF from 'jspdf';

// ---------------------------------------------------------------------------
// Font loading (mirrors invoice-pdf.ts NotoSans pattern)
// ---------------------------------------------------------------------------
const FONT_FAMILY = 'NotoSans';
const FONT_REGULAR = '/fonts/NotoSans-Regular.ttf';
const FONT_BOLD = '/fonts/NotoSans-Bold.ttf';
const LOGO_SRC = '/assets/yannis-logo-white-bg.png';

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
  if (typeof fetch === 'undefined') { fontLoadFailed = true; return null; }
  if (!fontInflight) {
    fontInflight = (async () => {
      try {
        const [rReg, rBold] = await Promise.all([fetch(FONT_REGULAR), fetch(FONT_BOLD)]);
        if (!rReg.ok || !rBold.ok) { fontLoadFailed = true; return null; }
        const [bufReg, bufBold] = await Promise.all([rReg.arrayBuffer(), rBold.arrayBuffer()]);
        fontBase64 = { regular: uint8ToBase64(new Uint8Array(bufReg)), bold: uint8ToBase64(new Uint8Array(bufBold)) };
        return fontBase64;
      } catch { fontLoadFailed = true; return null; }
    })();
  }
  return fontInflight;
}

async function embedFonts(doc: jsPDF): Promise<boolean> {
  const b64 = await loadFonts();
  if (!b64) return false;
  doc.addFileToVFS('NotoSans-Regular.ttf', b64.regular);
  doc.addFont('NotoSans-Regular.ttf', FONT_FAMILY, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', b64.bold);
  doc.addFont('NotoSans-Bold.ttf', FONT_FAMILY, 'bold');
  return true;
}

function loadLogo(): Promise<{ dataUrl: string; aspect: number } | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { resolve(null); return; }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: c.toDataURL('image/png'), aspect: w / h });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = LOGO_SRC;
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function fmt(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
}
function naira(n: number): string { return `\u20A6${fmt(n)}`; }
function today(): string { return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

// ---------------------------------------------------------------------------
// Shared PDF scaffolding
// ---------------------------------------------------------------------------
const PAGE_W = 210; // A4mm
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;

async function createDoc(): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const hasFont = await embedFonts(doc);
  if (hasFont) doc.setFont(FONT_FAMILY, 'normal');
  return doc;
}

async function drawLetterhead(doc: jsPDF, title: string, subtitle: string): Promise<number> {
  let y = MARGIN;
  const logo = await loadLogo();
  if (logo) {
    const logoH = 12; const logoW = logoH * logo.aspect;
    doc.addImage(logo.dataUrl, 'PNG', MARGIN, y, logoW, logoH);
    doc.setFontSize(14).setFont(FONT_FAMILY, 'bold');
    doc.text('Yannis EOSE', MARGIN + logoW + 4, y + 8);
    y += logoH + 4;
  } else {
    doc.setFontSize(14).setFont(FONT_FAMILY, 'bold');
    doc.text('Yannis EOSE', MARGIN, y + 5);
    y += 10;
  }
  // Separator
  doc.setDrawColor(200).setLineWidth(0.3).line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;
  // Title
  doc.setFontSize(12).setFont(FONT_FAMILY, 'bold').text(title, PAGE_W / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(9).setFont(FONT_FAMILY, 'normal').text(subtitle, PAGE_W / 2, y, { align: 'center' });
  y += 8;
  return y;
}

function drawFooter(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const y = 290;
    doc.setDrawColor(200).setLineWidth(0.3).line(MARGIN, y - 3, PAGE_W - MARGIN, y - 3);
    doc.setFontSize(7).setFont(FONT_FAMILY, 'normal');
    doc.text(`Generated on ${today()}`, MARGIN, y);
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, y, { align: 'right' });
  }
}

interface Column { label: string; width: number; align?: 'left' | 'right' | 'center' }

function drawTableHeader(doc: jsPDF, cols: Column[], y: number): number {
  doc.setFillColor(240, 240, 240);
  doc.rect(MARGIN, y, CONTENT_W, 7, 'F');
  doc.setFontSize(8).setFont(FONT_FAMILY, 'bold');
  let x = MARGIN;
  for (const col of cols) {
    const tx = col.align === 'right' ? x + col.width - 2 : x + 2;
    doc.text(col.label, tx, y + 5, { align: col.align === 'right' ? 'right' : 'left' });
    x += col.width;
  }
  return y + 8;
}

function drawRow(doc: jsPDF, cols: Column[], values: string[], y: number, opts?: { bold?: boolean; fill?: boolean }): number {
  if (opts?.fill) { doc.setFillColor(248, 248, 248); doc.rect(MARGIN, y - 0.5, CONTENT_W, 6, 'F'); }
  doc.setFontSize(8).setFont(FONT_FAMILY, opts?.bold ? 'bold' : 'normal');
  let x = MARGIN;
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!;
    const tx = col.align === 'right' ? x + col.width - 2 : x + 2;
    doc.text(values[i] ?? '', tx, y + 3.5, { align: col.align === 'right' ? 'right' : 'left' });
    x += col.width;
  }
  return y + 6;
}

function ensurePage(doc: jsPDF, y: number, needed = 12): number {
  if (y + needed > 280) { doc.addPage(); return MARGIN + 5; }
  return y;
}

function drawSectionTitle(doc: jsPDF, label: string, y: number): number {
  y = ensurePage(doc, y, 14);
  doc.setFontSize(9).setFont(FONT_FAMILY, 'bold').text(label, MARGIN, y + 4);
  return y + 7;
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------
export interface TrialBalanceRow { accountCode: string; accountName: string; debit: number; credit: number }
export interface TrialBalanceData { asAtDate: string; rows: TrialBalanceRow[]; companyName?: string }

export interface PnlSection { label: string; amount: number }
export interface PnlData {
  startDate: string; endDate: string; companyName?: string;
  revenue: PnlSection[]; costOfSales: PnlSection[]; operatingExpenses: PnlSection[];
  otherIncome?: PnlSection[]; otherExpenses?: PnlSection[];
  taxExpense?: number;
  comparative?: { revenue: PnlSection[]; costOfSales: PnlSection[]; operatingExpenses: PnlSection[]; otherIncome?: PnlSection[]; otherExpenses?: PnlSection[]; taxExpense?: number };
  comparativePeriod?: string;
}

export interface BsSection { label: string; amount: number }
export interface BalanceSheetData {
  asAtDate: string; companyName?: string;
  currentAssets: BsSection[]; nonCurrentAssets: BsSection[];
  currentLiabilities: BsSection[]; nonCurrentLiabilities: BsSection[];
  equity: BsSection[];
}

export interface CfSection { label: string; amount: number }
export interface CashFlowData {
  startDate: string; endDate: string; companyName?: string;
  operating: CfSection[]; investing: CfSection[]; financing: CfSection[];
  openingBalance: number;
}

// ---------------------------------------------------------------------------
// 1. Trial Balance
// ---------------------------------------------------------------------------
export async function generateTrialBalancePdf(data: TrialBalanceData): Promise<jsPDF> {
  const doc = await createDoc();
  const company = data.companyName ?? 'Yannis EOSE';
  let y = await drawLetterhead(doc, `${company} — Trial Balance`, `As at ${data.asAtDate}`);

  const cols: Column[] = [
    { label: 'Account Code', width: 30 },
    { label: 'Account Name', width: 80 },
    { label: 'Debit (\u20A6)', width: 35, align: 'right' },
    { label: 'Credit (\u20A6)', width: 35, align: 'right' },
  ];
  y = drawTableHeader(doc, cols, y);

  let totalDebit = 0, totalCredit = 0;
  for (const row of data.rows) {
    y = ensurePage(doc, y);
    y = drawRow(doc, cols, [row.accountCode, row.accountName, fmt(row.debit), fmt(row.credit)], y);
    totalDebit += row.debit;
    totalCredit += row.credit;
  }

  // Totals
  y = ensurePage(doc, y, 10);
  doc.setDrawColor(100).setLineWidth(0.4).line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 1;
  y = drawRow(doc, cols, ['', 'TOTALS', fmt(totalDebit), fmt(totalCredit)], y, { bold: true, fill: true });

  // Balance indicator
  const diff = Math.abs(totalDebit - totalCredit);
  y += 3;
  doc.setFontSize(9).setFont(FONT_FAMILY, 'bold');
  if (diff < 0.01) {
    doc.setTextColor(21, 128, 61).text('Balanced', PAGE_W / 2, y, { align: 'center' });
  } else {
    doc.setTextColor(220, 38, 38).text(`Out of balance by ${naira(diff)}`, PAGE_W / 2, y, { align: 'center' });
  }
  doc.setTextColor(0);

  drawFooter(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// 2. Profit & Loss
// ---------------------------------------------------------------------------
function sumSection(items: PnlSection[]): number { return items.reduce((s, i) => s + i.amount, 0); }

export async function generateProfitAndLossPdf(data: PnlData): Promise<jsPDF> {
  const doc = await createDoc();
  const company = data.companyName ?? 'Yannis EOSE';
  let y = await drawLetterhead(doc, `${company} — Profit & Loss Statement`, `${data.startDate} to ${data.endDate}`);

  const hasComp = !!data.comparative;
  const cols: Column[] = hasComp
    ? [{ label: '', width: 80 }, { label: 'Current (\u20A6)', width: 50, align: 'right' }, { label: `${data.comparativePeriod ?? 'Prior'} (\u20A6)`, width: 50, align: 'right' }]
    : [{ label: '', width: 110 }, { label: 'Amount (\u20A6)', width: 70, align: 'right' }];

  function renderSection(label: string, items: PnlSection[], compItems?: PnlSection[]) {
    y = drawSectionTitle(doc, label, y);
    for (const item of items) {
      y = ensurePage(doc, y);
      const compVal = compItems?.find((c) => c.label === item.label)?.amount;
      const vals = hasComp ? [item.label, fmt(item.amount), compVal != null ? fmt(compVal) : '-'] : [item.label, fmt(item.amount)];
      y = drawRow(doc, cols, vals, y);
    }
  }

  function renderSubtotal(label: string, current: number, prior?: number) {
    y = ensurePage(doc, y, 10);
    doc.setDrawColor(180).setLineWidth(0.2).line(MARGIN, y, PAGE_W - MARGIN, y); y += 1;
    const vals = hasComp ? [label, naira(current), prior != null ? naira(prior) : '-'] : [label, naira(current)];
    y = drawRow(doc, cols, vals, y, { bold: true, fill: true });
    y += 2;
  }

  const comp = data.comparative;
  const rev = sumSection(data.revenue);
  const cos = sumSection(data.costOfSales);
  const opex = sumSection(data.operatingExpenses);
  const otherIn = sumSection(data.otherIncome ?? []);
  const otherEx = sumSection(data.otherExpenses ?? []);
  const grossProfit = rev - cos;
  const ebit = grossProfit - opex;
  const pbt = ebit + otherIn - otherEx;
  const pat = pbt - (data.taxExpense ?? 0);

  const cRev = comp ? sumSection(comp.revenue) : undefined;
  const cCos = comp ? sumSection(comp.costOfSales) : undefined;
  const cOpex = comp ? sumSection(comp.operatingExpenses) : undefined;
  const cOtherIn = comp ? sumSection(comp.otherIncome ?? []) : undefined;
  const cOtherEx = comp ? sumSection(comp.otherExpenses ?? []) : undefined;
  const cGross = cRev != null && cCos != null ? cRev - cCos : undefined;
  const cEbit = cGross != null && cOpex != null ? cGross - cOpex : undefined;
  const cPbt = cEbit != null ? cEbit + (cOtherIn ?? 0) - (cOtherEx ?? 0) : undefined;
  const cPat = cPbt != null ? cPbt - (comp?.taxExpense ?? 0) : undefined;

  renderSection('Revenue', data.revenue, comp?.revenue);
  renderSubtotal('Total Revenue', rev, cRev);
  renderSection('Cost of Sales', data.costOfSales, comp?.costOfSales);
  renderSubtotal('Gross Profit', grossProfit, cGross);
  renderSection('Operating Expenses', data.operatingExpenses, comp?.operatingExpenses);
  renderSubtotal('EBIT', ebit, cEbit);
  if (data.otherIncome?.length) { renderSection('Other Income', data.otherIncome, comp?.otherIncome); }
  if (data.otherExpenses?.length) { renderSection('Other Expenses', data.otherExpenses, comp?.otherExpenses); }
  renderSubtotal('Profit Before Tax', pbt, cPbt);
  if (data.taxExpense != null) {
    y = drawRow(doc, cols, hasComp ? ['Tax Expense', fmt(data.taxExpense), comp?.taxExpense != null ? fmt(comp.taxExpense) : '-'] : ['Tax Expense', fmt(data.taxExpense)], y);
  }
  renderSubtotal('Profit After Tax', pat, cPat);

  drawFooter(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// 3. Balance Sheet
// ---------------------------------------------------------------------------
export async function generateBalanceSheetPdf(data: BalanceSheetData): Promise<jsPDF> {
  const doc = await createDoc();
  const company = data.companyName ?? 'Yannis EOSE';
  let y = await drawLetterhead(doc, `${company} — Statement of Financial Position`, `As at ${data.asAtDate}`);

  const cols: Column[] = [{ label: '', width: 110 }, { label: 'Amount (\u20A6)', width: 70, align: 'right' }];

  function renderGroup(label: string, items: BsSection[]) {
    y = drawSectionTitle(doc, label, y);
    for (const item of items) { y = ensurePage(doc, y); y = drawRow(doc, cols, [item.label, fmt(item.amount)], y); }
  }

  function renderSubtotal(label: string, amount: number) {
    y = ensurePage(doc, y, 10);
    doc.setDrawColor(180).setLineWidth(0.2).line(MARGIN, y, PAGE_W - MARGIN, y); y += 1;
    y = drawRow(doc, cols, [label, naira(amount)], y, { bold: true, fill: true }); y += 2;
  }

  const totalCA = data.currentAssets.reduce((s, i) => s + i.amount, 0);
  const totalNCA = data.nonCurrentAssets.reduce((s, i) => s + i.amount, 0);
  const totalAssets = totalCA + totalNCA;
  const totalCL = data.currentLiabilities.reduce((s, i) => s + i.amount, 0);
  const totalNCL = data.nonCurrentLiabilities.reduce((s, i) => s + i.amount, 0);
  const totalLiabilities = totalCL + totalNCL;
  const totalEquity = data.equity.reduce((s, i) => s + i.amount, 0);

  renderGroup('Current Assets', data.currentAssets);
  renderSubtotal('Total Current Assets', totalCA);
  renderGroup('Non-Current Assets', data.nonCurrentAssets);
  renderSubtotal('Total Non-Current Assets', totalNCA);
  renderSubtotal('TOTAL ASSETS', totalAssets);

  renderGroup('Current Liabilities', data.currentLiabilities);
  renderSubtotal('Total Current Liabilities', totalCL);
  renderGroup('Non-Current Liabilities', data.nonCurrentLiabilities);
  renderSubtotal('Total Non-Current Liabilities', totalNCL);
  renderSubtotal('TOTAL LIABILITIES', totalLiabilities);

  renderGroup('Equity', data.equity);
  renderSubtotal('TOTAL EQUITY', totalEquity);
  renderSubtotal('TOTAL LIABILITIES + EQUITY', totalLiabilities + totalEquity);

  // Balance check
  y += 2;
  const diff = Math.abs(totalAssets - (totalLiabilities + totalEquity));
  doc.setFontSize(9).setFont(FONT_FAMILY, 'bold');
  if (diff < 0.01) {
    doc.setTextColor(21, 128, 61).text('Assets = Liabilities + Equity', PAGE_W / 2, y, { align: 'center' });
  } else {
    doc.setTextColor(220, 38, 38).text(`Imbalance: ${naira(diff)}`, PAGE_W / 2, y, { align: 'center' });
  }
  doc.setTextColor(0);

  drawFooter(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// 4. Cash Flow
// ---------------------------------------------------------------------------
export async function generateCashFlowPdf(data: CashFlowData): Promise<jsPDF> {
  const doc = await createDoc();
  const company = data.companyName ?? 'Yannis EOSE';
  let y = await drawLetterhead(doc, `${company} — Cash Flow Statement`, `${data.startDate} to ${data.endDate}`);

  const cols: Column[] = [{ label: '', width: 110 }, { label: 'Amount (\u20A6)', width: 70, align: 'right' }];

  function renderGroup(label: string, items: CfSection[]) {
    y = drawSectionTitle(doc, label, y);
    for (const item of items) { y = ensurePage(doc, y); y = drawRow(doc, cols, [item.label, fmt(item.amount)], y); }
  }

  function renderSubtotal(label: string, amount: number) {
    y = ensurePage(doc, y, 10);
    doc.setDrawColor(180).setLineWidth(0.2).line(MARGIN, y, PAGE_W - MARGIN, y); y += 1;
    y = drawRow(doc, cols, [label, naira(amount)], y, { bold: true, fill: true }); y += 2;
  }

  const netOp = data.operating.reduce((s, i) => s + i.amount, 0);
  const netInv = data.investing.reduce((s, i) => s + i.amount, 0);
  const netFin = data.financing.reduce((s, i) => s + i.amount, 0);
  const netChange = netOp + netInv + netFin;
  const closing = data.openingBalance + netChange;

  renderGroup('Operating Activities', data.operating);
  renderSubtotal('Net Cash from Operations', netOp);
  renderGroup('Investing Activities', data.investing);
  renderSubtotal('Net Cash from Investing', netInv);
  renderGroup('Financing Activities', data.financing);
  renderSubtotal('Net Cash from Financing', netFin);

  // Summary
  y = ensurePage(doc, y, 30);
  doc.setDrawColor(100).setLineWidth(0.4).line(MARGIN, y, PAGE_W - MARGIN, y); y += 2;
  y = drawRow(doc, cols, ['Net Change in Cash', naira(netChange)], y, { bold: true, fill: true });
  y = drawRow(doc, cols, ['Opening Balance', naira(data.openingBalance)], y);
  y += 1;
  doc.setDrawColor(100).setLineWidth(0.4).line(MARGIN, y, PAGE_W - MARGIN, y); y += 1;
  y = drawRow(doc, cols, ['Closing Balance', naira(closing)], y, { bold: true, fill: true });

  drawFooter(doc);
  return doc;
}
