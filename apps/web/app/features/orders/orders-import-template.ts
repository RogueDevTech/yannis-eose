/**
 * Browser-only template generator for the Orders bulk-import flow.
 * Follows the same pattern as products/users — `aoa_to_sheet` for plain
 * Excel output (no styling so Excel doesn't auto-suggest "Format as Table").
 */

import * as XLSX from 'xlsx';

const TEMPLATE_HEADERS = [
  'Order ID',
  'Date',
  'Name',
  'Phone Number',
  'WhatsApp Number',
  'Email',
  'Address',
  'State',
  'Product ID',
  'Product Name',
  'Quantity',
  'Cost',
  'Currency',
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

// One width per TEMPLATE_HEADERS column (25). Branch ID removed — branch is
// derived from the media buyer / CS user, never supplied on the sheet.
const COLUMN_WIDTHS: number[] = [
  16, 16, 22, 16, 16, 28, 44, 10,
  12, 24, 10, 12, 10, 8, 14, 36,
  28, 16, 14, 16, 14, 18,
  36, 36, 30,
];

export function downloadOrdersImportTemplate(): void {
  const ws = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    [
      'CRM-1001', '4/29/2026', 'Chuks David', '08068880766', '08068880766',
      'chuks@example.com', 'O Cube Court Lafaji', 'Lagos',
      'PDT-1', 'Sample Product One', 1, 100000, 'NGN', 'Male', 'Tomorrow', '',
      'Delivered and Cash Remitted', 'Exre', 'USR-5', 'Annual', 'USR-12', 'Fomac Lagos',
      '', '', '',
    ],
    [
      'CRM-1002', '5/2/2026', 'Adamu Garba', '07012345678', '07012345678',
      'adamu@example.com', '12 Adeola Odeku, Victoria Island', 'Lagos',
      'PDT-2', 'Sample Product Two', 1, 100000, 'Nigeria', 'Male', '3 Days', 'Gate is blue',
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
    ['Order ID', 'Required. A unique ID from your source (the idempotency key). Re-importing the same ID OVERWRITES that order instead of creating a duplicate.'],
    ['Date', 'Order date. Accepts "4/29/2026", "5/2/2026 9:05:30", or ISO format. Optional — defaults to today.'],
    ['Name', 'Customer name. Required, min 2 characters.'],
    ['Phone Number', 'Customer phone. Required. Accepts any format (spaces, dashes tolerated).'],
    ['WhatsApp Number', 'Optional. Stored as reference in custom fields.'],
    ['Email', 'Optional. Must be a valid email if provided.'],
    ['Address', 'Customer / delivery address. Optional.'],
    ['State', 'Delivery state (e.g. Lagos, Abuja, Rivers). Optional.'],
    ['Product ID', 'Required. Product code (e.g. PDT-1). Find codes on the Products page. An unknown code fails the row.'],
    ['Product Name', 'Optional reference only. Helps you confirm the Product ID: the import ignores this column and matches on Product ID.'],
    ['Quantity', 'Number of units. Defaults to 1 if blank.'],
    ['Cost', 'Order total. Currency symbols, commas, and decimals are tolerated (e.g. ₦100,000 or 100000).'],
    ['Currency', 'Optional. Currency code or country name (e.g. NGN, GHS, Ghana). If blank, uses the media buyer / closer country, then the base currency. An unknown currency fails the row.'],
    ['Gender', 'Optional (e.g. Male, Female).'],
    ['Delivery Time', 'Optional free text (e.g. Tomorrow, 3 Days, Today).'],
    ['More details', 'Optional notes about delivery.'],
    ['Status', 'Required. See valid values below.'],
    ['Media-Buyer', 'Optional. Stored as reference (name). The Media Buyer ID column drives attribution.'],
    ['Media Buyer ID', 'Optional. User code (e.g. USR-5). Attributes the order to that media buyer. An unknown code fails the row so you can fix the code or the record. The order branch is derived from this user.'],
    ['CS', 'Optional. Stored as reference (name). The CS ID column drives assignment.'],
    ['CS ID', 'Optional. User code (e.g. USR-12). Assigns the order to that CS closer. An unknown code fails the row so you can fix the code or the record.'],
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
