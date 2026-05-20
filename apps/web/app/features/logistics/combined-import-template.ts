/**
 * Browser-only template generator for the combined provider + location
 * bulk-import flow. Matches the format the Head of Logistics already uses
 * in the "Yannis appsheet" spreadsheet.
 */

import * as XLSX from 'xlsx';

const TEMPLATE_HEADERS = [
  'Provider',
  'Coverage Area',
  'Contact Phone',
  'Location Name',
  'Location Address',
  'State',
  'WhatsApp Group Link',
] as const;
const COLUMN_WIDTHS: number[] = [22, 28, 20, 22, 36, 18, 40];

export function downloadCombinedImportTemplate(): void {
  const ws = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    [
      'Olaasiyah',
      'Lagos',
      '2347067737784',
      '',
      '',
      'Lagos',
      'https://chat.whatsapp.com/LeHwMWSVIBZ758a4SWV9dN',
    ],
    [
      'Stevekayz',
      'Lagos - Lagos outskirt',
      '2348102435380',
      '',
      '',
      'Lagos',
      'https://chat.whatsapp.com/FTubqNFdun00c0EfrSDnoa',
    ],
    [
      'Dare',
      'Abuja & Nassarawa',
      '2347010440314',
      '',
      '',
      'FCT Abuja',
      'https://chat.whatsapp.com/III0jIiL1MY0IsO2gVnfui',
    ],
  ]);
  ws['!cols'] = COLUMN_WIDTHS.map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Import');

  const referenceRows: string[][] = [
    ['Column', 'Rule'],
    [
      'Provider',
      'Required. 3PL company name (2–200 chars). If it already exists, the row links to the existing provider. If new, the provider is auto-created.',
    ],
    [
      'Coverage Area',
      'Required. States or regions this provider covers (1–500 chars). Also used as the provider coverage area when auto-creating.',
    ],
    [
      'Contact Phone',
      'Required. Provider phone number (1–500 chars). Cleaned automatically (trailing .0, spaces, formula prefixes stripped).',
    ],
    [
      'Location Name',
      'Optional. Short label like "Lekki hub" or "Abuja CBD" (2–200 chars). If blank, defaults to the Coverage Area value.',
    ],
    [
      'Location Address',
      'Optional. Full address (5–500 chars). If blank, falls back to the Coverage Area value.',
    ],
    [
      'State',
      'Required. One of the 36 Nigerian states or "FCT Abuja". Must match exactly (e.g. "Lagos", "Rivers", "Anambra", "FCT Abuja").',
    ],
    [
      'WhatsApp Group Link',
      'Optional. https://chat.whatsapp.com/... or https://wa.me/... — anything else is rejected.',
    ],
    ['', ''],
    ['Note', 'Providers are idempotent — if a provider with the same name already exists, no duplicate is created. Locations are created or updated by name.'],
  ];
  const refWs = XLSX.utils.aoa_to_sheet(referenceRows);
  refWs['!cols'] = [{ wch: 24 }, { wch: 72 }];
  XLSX.utils.book_append_sheet(wb, refWs, 'Reference');

  XLSX.writeFile(wb, 'yannis-combined-import-template.xlsx');
}
