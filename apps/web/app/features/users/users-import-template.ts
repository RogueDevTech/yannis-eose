/**
 * Generate + trigger download of the user-import template workbook.
 *
 * Browser-only — uses `xlsx`'s `writeFile` which streams a Blob into a
 * temporary anchor click. Imported lazily by the page so the import code
 * doesn't ship on routes that don't use it.
 *
 * The workbook is intentionally PLAIN — no cell comments / Notes (those
 * render as red-triangle / yellow-tinted boxes that look like junk), no
 * fills, no fonts, no table styles. Just a header row, two sample rows,
 * and a Reference sheet listing valid roles + branches. Excel's default
 * theme renders this as a stock spreadsheet — no green gradient, no
 * "Format as Table" auto-suggestion.
 */

import * as XLSX from 'xlsx';
import {
  type BranchInfo,
  SPREADSHEET_IMPORT_ROLE_REFERENCE,
} from './users-import-shared';

/** Friendly headers used in the template workbook. The import parser is
 *  case-insensitive and treats whitespace / dashes as underscores so these
 *  resolve back to the canonical snake_case keys. */
const TEMPLATE_HEADERS = [
  'Name',
  'Email',
  'Role',
  'Phone',
  'Primary Branch',
  'Additional Branches',
  'Probation',
  'Probation Until',
] as const;

const COLUMN_WIDTHS: number[] = [22, 28, 18, 16, 18, 22, 12, 16];

export function downloadUsersImportTemplate(branches: BranchInfo[]): void {
  const sampleBranchCode = branches[0]?.code ?? 'LAG';
  const sampleSecondBranch = branches[1]?.code ?? '';

  // `aoa_to_sheet` produces the most minimal cell set — just text values, no
  // structured-table metadata that Excel might pick up as a "Suggested Table"
  // and auto-style with its default green/blue header gradient.
  const ws = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    [
      'Jane Doe',
      'jane.doe@example.com',
      'Sales Closer',
      '08031234567',
      sampleBranchCode,
      sampleSecondBranch,
      'false',
      '',
    ],
    [
      'Tunde Bello',
      'tunde.bello@example.com',
      'Media Buyer',
      '+2348022223333',
      sampleBranchCode,
      '',
      'true',
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    ],
  ]);
  ws['!cols'] = COLUMN_WIDTHS.map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Users');

  // ── Reference sheet — column rules + role enum + live branches ────
  // Same minimal AOA shape; no comments, no styling.
  const referenceRows: string[][] = [
    ['Column', 'Rule'],
    ['Name', 'Free text. Min 2 characters.'],
    ['Email', 'Unique login email.'],
    ['Role', 'Pick from the list below (enum or label).'],
    ['Phone', 'Nigerian: 08031234567 or +2348031234567.'],
    ['Primary Branch', 'Branch CODE or NAME (case-insensitive).'],
    ['Additional Branches', 'Comma- or semicolon-separated.'],
    ['Probation', 'true / false / yes / no. Empty = no.'],
    ['Probation Until', 'ISO date (YYYY-MM-DD).'],
    ['', ''],
    ['Valid roles (enum)', 'Accepted labels'],
    ...SPREADSHEET_IMPORT_ROLE_REFERENCE.map((r) => [r.enum, r.acceptedLabels]),
    ['', ''],
    [
      'Valid branches (code)',
      branches.length > 0 ? 'Branch name' : 'No branches configured yet',
    ],
    ...branches.map((b) => [b.code, b.name]),
  ];
  const refWs = XLSX.utils.aoa_to_sheet(referenceRows);
  refWs['!cols'] = [{ wch: 24 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, refWs, 'Reference');

  XLSX.writeFile(wb, 'yannis-users-import-template.xlsx');
}
