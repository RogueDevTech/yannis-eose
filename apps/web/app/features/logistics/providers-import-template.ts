/**
 * Browser-only template generator for the Providers (3PL) bulk-import flow.
 * Plain Excel (`aoa_to_sheet`, no styling) so the workbook opens without the
 * green "Format as Table" auto-suggestion.
 */

import * as XLSX from 'xlsx';

const TEMPLATE_HEADERS = ['Name', 'Contact Info', 'Coverage Area'] as const;
const COLUMN_WIDTHS: number[] = [28, 36, 36];

export function downloadProvidersImportTemplate(): void {
  const ws = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    [
      'GIG Logistics',
      'dispatch@giglogistics.com · +2348031234567',
      'Lagos, Ogun, Oyo',
    ],
    [
      'Konga Express',
      'partners@konga.com · 0700KONGA',
      'Nigeria-wide',
    ],
  ]);
  ws['!cols'] = COLUMN_WIDTHS.map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Providers');

  const referenceRows: string[][] = [
    ['Column', 'Rule'],
    ['Name', 'Free text. 2–200 characters. Should be the company name.'],
    [
      'Contact Info',
      'Free text. 1–500 characters. Phone, email, or both — separate with " · " or "/".',
    ],
    [
      'Coverage Area',
      'Free text. 1–500 characters. Comma-separated states or "Nigeria-wide".',
    ],
  ];
  const refWs = XLSX.utils.aoa_to_sheet(referenceRows);
  refWs['!cols'] = [{ wch: 24 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, refWs, 'Reference');

  XLSX.writeFile(wb, 'yannis-providers-import-template.xlsx');
}
