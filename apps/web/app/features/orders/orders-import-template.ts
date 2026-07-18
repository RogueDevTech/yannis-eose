/**
 * Browser-only template generator for the Orders bulk-import flow.
 * Follows the same pattern as products/users — `aoa_to_sheet` for plain
 * Excel output (no styling so Excel doesn't auto-suggest "Format as Table").
 */

import * as XLSX from 'xlsx';

const TEMPLATE_HEADERS = [
  'Date',
  'Name',
  'Phone Number',
  'WhatsApp Number',
  'Email',
  'Address',
  'State',
  'Quantity',
  'Cost',
  'Gender',
  'Delivery Time',
  'More details',
  'Status',
  'Media-Buyer',
  'Media Buyer ID',
  'CS',
  'CS ID',
  'Delivery agent',
  'Comment 1',
  'Comment 2',
  'Comment 3',
] as const;

const COLUMN_WIDTHS: number[] = [
  16, 22, 16, 16, 28, 44, 10,
  10, 12, 8, 14, 36,
  28, 14, 14, 10, 14, 18,
  36, 36, 30,
];

export function downloadOrdersImportTemplate(): void {
  const ws = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    [
      '4/29/2026', 'Chuks David', '08068880766', '08068880766',
      'chuks@example.com', 'O Cube Court Lafaji', 'Lagos',
      1, 100000, 'Male', 'Tomorrow', '',
      'Delivered and Cash Remitted', 'Exre', 'USR-5', 'Annual', 'USR-12', 'Fomac Lagos',
      '', '', '',
    ],
    [
      '5/2/2026', 'Adamu Garba', '07012345678', '07012345678',
      'adamu@example.com', '12 Adeola Odeku, Victoria Island', 'Lagos',
      1, 100000, 'Male', '3 Days', 'Gate is blue',
      'Pending', 'Exre', '', 'Annual', '', '',
      'Customer wants morning delivery', '', '',
    ],
  ]);
  ws['!cols'] = COLUMN_WIDTHS.map((w) => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Orders');

  // ── Reference sheet — column rules + status values ────
  const referenceRows: string[][] = [
    ['Column', 'Rule'],
    ['Date', 'Order date. Accepts "4/29/2026", "5/2/2026 9:05:30", or ISO format. Optional — defaults to today.'],
    ['Name', 'Customer name. Required, min 2 characters.'],
    ['Phone Number', 'Customer phone. Required. Accepts any format (spaces, dashes tolerated).'],
    ['WhatsApp Number', 'Optional. Stored as reference in custom fields.'],
    ['Email', 'Optional. Must be a valid email if provided.'],
    ['Address', 'Customer / delivery address. Optional.'],
    ['State', 'Delivery state (e.g. Lagos, Abuja, Rivers). Optional.'],
    ['Quantity', 'Number of units. Defaults to 1 if blank.'],
    ['Cost', 'Order total in Naira. ₦, commas, and decimals are tolerated (e.g. ₦100,000 or 100000).'],
    ['Gender', 'Optional (e.g. Male, Female).'],
    ['Delivery Time', 'Optional free text (e.g. Tomorrow, 3 Days, Today).'],
    ['More details', 'Optional notes about delivery.'],
    ['Status', 'Required. See valid values below.'],
    ['Media-Buyer', 'Optional. Stored as reference — batch MB is selected on the import page.'],
    ['Media Buyer ID', 'Optional. User number (e.g. USR-42). Overrides the batch default media buyer for this row.'],
    ['CS', 'Optional. Stored as reference — batch CS agent is selected on the import page.'],
    ['CS ID', 'Optional. User number (e.g. USR-12). Overrides the batch default CS agent for this row.'],
    ['Delivery agent', 'Optional. Stored as reference in custom fields.'],
    ['Comment 1–3', 'Optional. Combined and stored in custom fields.'],
    ['', ''],
    ['Valid statuses', ''],
    ['Pending', 'Imported as CS_ASSIGNED — assigned to the selected CS agent, ready to work.'],
    ['Delivered and Cash Remitted', 'Imported as REMITTED — historical completed order.'],
  ];
  const refWs = XLSX.utils.aoa_to_sheet(referenceRows);
  refWs['!cols'] = [{ wch: 28 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, refWs, 'Reference');

  XLSX.writeFile(wb, 'yannis-orders-import-template.xlsx');
}
