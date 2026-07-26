import type { CashLedgerStatement } from '~/features/finance/cash-statement-types';

export type CashStatementExportSheet = {
  name: string;
  rows: Array<Record<string, unknown>>;
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
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

/** Flat CSV/XLSX sheets for a cash statement (summary + awaiting + batches + order lines). */
export function buildCashStatementExportSheets(statement: CashLedgerStatement): CashStatementExportSheet[] {
  const { header, summary } = statement;
  const scopeLabel =
    header.scope === 'location'
      ? `${header.providerName} / ${header.locationName ?? 'Location'}`
      : header.providerName;

  const summaryRows: Array<Record<string, unknown>> = [
    { field: 'Partner', value: header.providerName },
    { field: 'Scope', value: scopeLabel },
    {
      field: 'Period',
      value:
        header.startDate || header.endDate
          ? `${header.startDate ?? '…'} to ${header.endDate ?? '…'}`
          : 'All time',
    },
    {
      field: 'Date scope',
      value: header.dateScope === 'deliveredAt' ? 'Delivery date' : 'Order date',
    },
    { field: 'Generated at', value: fmtDate(header.generatedAt) },
    { field: 'Awaiting cash (net)', value: Number(summary.awaitingCash) },
    { field: 'Awaiting orders', value: summary.awaitingCount },
    { field: 'Pending cash (net)', value: Number(summary.pendingCash) },
    { field: 'Pending orders', value: summary.pendingCount },
    { field: 'Remitted cash (net)', value: Number(summary.remittedCash) },
    { field: 'Remitted orders', value: summary.remittedCount },
    { field: 'Disputed cash (net)', value: Number(summary.disputedCash) },
    { field: 'Disputed orders', value: summary.disputedCount },
    { field: 'Delivery fees', value: Number(summary.deliveryFees) },
    { field: 'Commitment fees', value: Number(summary.commitmentFees) },
    { field: 'POS fees', value: Number(summary.posFees) },
    { field: 'Failed delivery costs', value: Number(summary.failedDeliveryCosts) },
    { field: 'Discounts', value: Number(summary.discounts) },
    { field: 'Waybill costs', value: Number(summary.waybillCosts) },
    { field: 'Batch fees total', value: Number(summary.batchFeesTotal) },
    { field: 'Net owed to Finance', value: Number(summary.netOwedToFinance) },
  ];

  const awaitingRows = statement.locations.flatMap((loc) =>
    loc.awaitingOrders.map((o) => ({
      location: loc.locationName,
      partner: loc.providerName ?? header.providerName,
      orderRef: o.orderRef,
      deliveredAt: fmtDate(o.deliveredAt),
      gross: Number(o.gross),
      deliveryFee: Number(o.deliveryFee),
      net: Number(o.net),
    })),
  );

  const batchRows = statement.locations.flatMap((loc) =>
    loc.batches.map((b) => ({
      location: loc.locationName,
      partner: loc.providerName ?? header.providerName,
      batchId: b.id,
      sentAt: fmtDate(b.sentAt),
      status: STATUS_LABEL[b.status] ?? b.status,
      orderCount: b.orderCount,
      grossNets: Number(b.grossNets),
      deliveryFeeTotal: Number(b.deliveryFeeTotal),
      commitmentFee: Number(b.commitmentFee),
      posFee: Number(b.posFee),
      failedDeliveryCost: Number(b.failedDeliveryCost),
      discount: Number(b.discount),
      waybillCost: Number(b.waybillCost),
      batchFeesTotal: Number(b.batchFeesTotal),
    })),
  );

  const orderLineRows = statement.locations.flatMap((loc) =>
    loc.orderLines.map((line) => ({
      location: loc.locationName,
      partner: loc.providerName ?? header.providerName,
      orderRef: line.orderRef,
      batchId: line.remittanceId,
      remittanceStatus: STATUS_LABEL[line.remittanceStatus] ?? line.remittanceStatus,
      sentAt: fmtDate(line.sentAt),
      deliveredAt: fmtDate(line.deliveredAt),
      gross: Number(line.gross),
      deliveryFee: Number(line.deliveryFee),
      net: Number(line.net),
    })),
  );

  return [
    { name: 'Summary', rows: summaryRows },
    { name: 'Awaiting', rows: awaitingRows },
    { name: 'Batches', rows: batchRows },
    { name: 'Order lines', rows: orderLineRows },
  ];
}

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function sheetToCsv(sheet: CashStatementExportSheet): string {
  if (sheet.rows.length === 0) {
    return `${escapeCsvField('Section')},${escapeCsvField(sheet.name)}\n${escapeCsvField('(no rows)')},`;
  }
  const keys = Object.keys(sheet.rows[0]!);
  const header = keys.map((k) => escapeCsvField(k)).join(',');
  const body = sheet.rows.map((row) => keys.map((k) => escapeCsvField(row[k])).join(','));
  return [header, ...body].join('\n');
}

export function buildCashStatementCsv(statement: CashLedgerStatement): string {
  const sheets = buildCashStatementExportSheets(statement);
  return sheets
    .map((sheet) => `### ${sheet.name}\n${sheetToCsv(sheet)}`)
    .join('\n\n');
}

function triggerBlobDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function buildCashStatementCsvBlob(statement: CashLedgerStatement): Blob {
  return new Blob([buildCashStatementCsv(statement)], { type: 'text/csv;charset=utf-8' });
}

export async function buildCashStatementXlsxBlob(statement: CashLedgerStatement): Promise<Blob> {
  const xlsx = await import('xlsx');
  const sheets = buildCashStatementExportSheets(statement);
  const wb = xlsx.utils.book_new();
  for (const sheet of sheets) {
    const ws = xlsx.utils.json_to_sheet(sheet.rows.length ? sheet.rows : [{ note: 'No rows' }]);
    xlsx.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  const bytes = xlsx.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export async function downloadCashStatementCsv(statement: CashLedgerStatement, filename: string) {
  const name = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  triggerBlobDownload(name, buildCashStatementCsvBlob(statement));
}

export async function downloadCashStatementXlsx(statement: CashLedgerStatement, filename: string) {
  const name = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  triggerBlobDownload(name, await buildCashStatementXlsxBlob(statement));
}

export async function downloadCashStatementZip(
  files: Array<{ filename: string; blob: Blob }>,
  zipFilename: string,
) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const used = new Map<string, number>();
  for (const file of files) {
    const count = used.get(file.filename) ?? 0;
    used.set(file.filename, count + 1);
    const name =
      count === 0
        ? file.filename
        : file.filename.replace(/(\.[^.]+)$/, `-${count + 1}$1`);
    zip.file(name, file.blob);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(
    zipFilename.endsWith('.zip') ? zipFilename : `${zipFilename}.zip`,
    blob,
  );
}

export function cashStatementFilenameBase(statement: CashLedgerStatement): string {
  const slug = (statement.header.locationName ?? statement.header.providerName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const start = statement.header.startDate ?? 'all';
  const end = statement.header.endDate ?? 'time';
  return `cash-statement-${slug || 'ledger'}-${start}-${end}`;
}
