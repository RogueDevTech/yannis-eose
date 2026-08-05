/**
 * Bank Pay List — bank-upload CSV.
 *
 * Produces a flat, structured file that can be submitted directly to the bank
 * for bulk salary processing. Column headers use the exact field names the bank
 * requires so the file needs no manual editing before upload.
 */
import { toCsv, downloadCsv } from './csv-export';
import { bankPayNarration, type BankPayPdfInput } from './bank-pay-pdf';

// Bank-upload column labels. Order matters for most bank templates.
const BANK_UPLOAD_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'bankCode', label: 'Bank Code' },
  { key: 'accountNumber', label: 'Account Number' },
  { key: 'beneficiaryName', label: 'Account Name' },
  { key: 'amount', label: 'Net Amount Payable' },
  { key: 'narration', label: 'Narration' },
];

/**
 * Flatten a Bank Pay document into bank-upload rows.
 * Amount is emitted as a plain 2-decimal number (no currency symbol / grouping)
 * so the bank template parses it cleanly.
 */
export function bankPayUploadRows(doc: BankPayPdfInput) {
  return doc.batches.flatMap((batch) =>
    batch.rows.map((row) => ({
      bankCode: row.bankCode || '',
      accountNumber: row.accountNumber || '',
      beneficiaryName: row.beneficiaryName || row.staffName || 'Unknown',
      amount: Number(row.amount).toFixed(2),
      narration: bankPayNarration(row),
    })),
  );
}

export function bankPayUploadCsv(doc: BankPayPdfInput): string {
  return toCsv(bankPayUploadRows(doc), BANK_UPLOAD_COLUMNS);
}

export function downloadBankPayUploadCsv(doc: BankPayPdfInput, filename: string): void {
  downloadCsv(bankPayUploadCsv(doc), filename);
}
