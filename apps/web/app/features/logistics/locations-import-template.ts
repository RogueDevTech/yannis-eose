/**
 * Browser-only template generator for the Locations bulk-import flow. Plain
 * Excel (`aoa_to_sheet`, no styling) so the workbook opens without the green
 * "Format as Table" auto-suggestion.
 */

import * as XLSX from 'xlsx';
import type { ProviderInfo } from './locations-import-shared';

const TEMPLATE_HEADERS = [
  'Provider',
  'Name',
  'Address',
  'Coordinates',
  'WhatsApp Group Link',
] as const;
const COLUMN_WIDTHS: number[] = [22, 22, 40, 22, 40];

export function downloadLocationsImportTemplate(providers: ProviderInfo[]): void {
  const sampleProvider = providers[0]?.name ?? 'GIG Logistics';
  const sampleProvider2 = providers[1]?.name ?? sampleProvider;

  const ws = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    [
      sampleProvider,
      'Lekki hub',
      '24 Admiralty Way, Lekki Phase 1, Lagos',
      '6.4426,3.4525',
      'https://chat.whatsapp.com/ABCD1234567890',
    ],
    [
      sampleProvider2,
      'Abuja CBD',
      'Plot 14, Wuse II, Abuja',
      '',
      '',
    ],
  ]);
  ws['!cols'] = COLUMN_WIDTHS.map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Locations');

  const referenceRows: string[][] = [
    ['Column', 'Rule'],
    [
      'Provider',
      'Required. Match a row from the Providers list below (case-insensitive name) or paste the provider UUID.',
    ],
    ['Name', 'Free text. 2–200 characters. Short label like "Lekki hub" or "Abuja CBD".'],
    ['Address', 'Free text. 5–500 characters. Full street address.'],
    [
      'Coordinates',
      'Optional. "lat,lng" pair, max 100 characters. Used by route-optimisation features.',
    ],
    [
      'WhatsApp Group Link',
      'Optional. https://chat.whatsapp.com/... or https://wa.me/... — anything else is rejected.',
    ],
    ['', ''],
    [
      'Valid providers (name)',
      providers.length > 0 ? 'Provider id (UUID, pasting also works)' : 'No providers configured yet',
    ],
    ...providers.map((p) => [p.name, p.id]),
  ];
  const refWs = XLSX.utils.aoa_to_sheet(referenceRows);
  refWs['!cols'] = [{ wch: 30 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, refWs, 'Reference');

  XLSX.writeFile(wb, 'yannis-locations-import-template.xlsx');
}
