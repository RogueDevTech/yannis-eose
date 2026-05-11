/**
 * Browser-only template generator for the Products bulk-import flow. Mirrors
 * the Users template — `aoa_to_sheet` for plain Excel output (no cell
 * comments, no fills, no fonts) so Excel doesn't auto-suggest "Format as
 * Table" with its green/blue gradient header.
 */

import * as XLSX from 'xlsx';
import type { CategoryInfo } from './products-import-shared';

const TEMPLATE_HEADERS = [
  'Name',
  'Base Price',
  'Cost Price',
  'Category',
  'Description',
  'Gallery URLs',
] as const;

const COLUMN_WIDTHS: number[] = [24, 12, 12, 18, 40, 50];

export function downloadProductsImportTemplate(categories: CategoryInfo[]): void {
  const sampleCategoryA = categories[0]?.name ?? 'Wellness';
  const sampleCategoryB = categories[1]?.name ?? categories[0]?.name ?? 'Healthy';

  const ws = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    [
      'Arjuna herb',
      30000,
      18000,
      sampleCategoryA,
      'Herbal supplement for heart health.',
      'https://cdn.example.com/arjuna-1.jpg, https://cdn.example.com/arjuna-2.jpg',
    ],
    [
      'Nebulizer kit',
      12000,
      7250,
      sampleCategoryB,
      'Asthma nebulizer kit.',
      'https://cdn.example.com/nebulizer.jpg',
    ],
  ]);
  ws['!cols'] = COLUMN_WIDTHS.map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');

  // ── Reference sheet — column rules + live category list ────
  const referenceRows: string[][] = [
    ['Column', 'Rule'],
    ['Name', 'Free text. Min 2 characters.'],
    ['Base Price', 'Number ≥ 0. ₦, commas, decimals all tolerated.'],
    ['Cost Price', 'Number ≥ 0.'],
    [
      'Category',
      categories.length > 0
        ? 'Pick one of the values listed below (case-insensitive). Leave blank for no category.'
        : 'Optional. Match a name from Admin → Categories — none configured yet.',
    ],
    ['Description', 'Free text — short blurb.'],
    ['Gallery URLs', 'Public http(s) URLs, comma- or semicolon-separated.'],
    ['', ''],
    [
      'Valid categories',
      categories.length > 0 ? '' : 'No categories configured yet',
    ],
    ...categories.map((c) => [c.name, '']),
  ];
  const refWs = XLSX.utils.aoa_to_sheet(referenceRows);
  refWs['!cols'] = [{ wch: 24 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, refWs, 'Reference');

  XLSX.writeFile(wb, 'yannis-products-import-template.xlsx');
}
