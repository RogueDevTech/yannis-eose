/**
 * PAYE Remittance Export (Track D#5) — the schedule HR submits to the Revenue
 * Office. One row per taxable staff payout: Name, TIN, Role, Phone, Gross,
 * statutory deductions (Rent Relief, Pension, NHIS ...), Net, PAYE. Exempt staff
 * show PAYE 0. Mirrors the bank-pay CSV pattern (toCsv + downloadCsv).
 */
import { toCsv, downloadCsv, asSpreadsheetText } from './csv-export';

export interface PayeRemittanceRow {
  staffName: string;
  tin: string;
  role: string;
  phone: string;
  grossPay: number;
  statutoryDeductions: Array<{ name: string; amount: number }>;
  statutoryTotal: number;
  reliefBreakdown: Array<{ name: string; amount: number }>;
  netPay: number;
  payeTax: number;
}

export interface PayeRemittanceDoc {
  periodMonth: string | null;
  rows: PayeRemittanceRow[];
}

/** Sum a named line out of a breakdown list (case-insensitive contains match). */
function sumMatching(list: Array<{ name: string; amount: number }>, needle: string): number {
  return list
    .filter((l) => l.name.toLowerCase().includes(needle))
    .reduce((acc, l) => acc + Number(l.amount || 0), 0);
}

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'staffName', label: 'Staff Name' },
  { key: 'tin', label: 'Tax ID (TIN)' },
  { key: 'role', label: 'Role' },
  { key: 'phone', label: 'Phone Number' },
  { key: 'grossPay', label: 'Gross Salary' },
  { key: 'rentRelief', label: 'Rent Relief' },
  { key: 'pension', label: 'Pension' },
  { key: 'nhis', label: 'NHIS' },
  { key: 'statutoryOther', label: 'Other Statutory' },
  { key: 'netPay', label: 'Net Salary' },
  { key: 'payeTax', label: 'PAYE' },
];

export function payeRemittanceRows(doc: PayeRemittanceDoc) {
  return doc.rows.map((r) => {
    const pension = sumMatching(r.statutoryDeductions, 'pension');
    const nhis = sumMatching(r.statutoryDeductions, 'nhis');
    const rentRelief = sumMatching(r.reliefBreakdown, 'rent');
    const statutoryOther = Math.max(0, Number(r.statutoryTotal || 0) - pension - nhis);
    return {
      staffName: r.staffName || '',
      // Phone + TIN are identifiers, not quantities — keep them as literal text so
      // Excel doesn't turn "2349140000000" into "2.34914E+12" and lose the digits.
      tin: asSpreadsheetText(r.tin || ''),
      role: r.role || '',
      phone: asSpreadsheetText(r.phone || ''),
      grossPay: Number(r.grossPay).toFixed(2),
      rentRelief: rentRelief.toFixed(2),
      pension: pension.toFixed(2),
      nhis: nhis.toFixed(2),
      statutoryOther: statutoryOther.toFixed(2),
      netPay: Number(r.netPay).toFixed(2),
      payeTax: Number(r.payeTax).toFixed(2),
    };
  });
}

export function payeRemittanceCsv(doc: PayeRemittanceDoc): string {
  return toCsv(payeRemittanceRows(doc), COLUMNS);
}

export function downloadPayeRemittanceCsv(doc: PayeRemittanceDoc, filename: string): void {
  downloadCsv(payeRemittanceCsv(doc), filename);
}
