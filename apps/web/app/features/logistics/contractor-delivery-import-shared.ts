/**
 * Pure utilities for the offline contractor-delivery bulk-import flow.
 * Each sheet row is one delivered order credited to a contractor / delivery
 * manager who has no CRM account. Framework-free so the column renderers,
 * sheet parser, and resolver share one validation contract.
 */

import {
  pickHeaderValue,
  parseNumeric,
  parseExcelDate,
  resolveProduct,
  type ProductInfo,
} from '~/features/orders/orders-import-shared';

export type { ProductInfo };

export interface ContractorParsedRow {
  rowIndex: number;
  dateInput: string;
  contractorInput: string;
  customerInput: string;
  phoneInput: string;
  addressInput: string;
  stateInput: string;
  productInput: string;
  quantityInput: string;
  amountInput: string;
  remittedInput: string;
}

export interface ContractorResolvedRow extends ContractorParsedRow {
  productId: string | null;
  productName: string | null;
  quantity: number;
  amount: number | null;
  remitted: boolean;
  deliveredAtIso: string | null;
  errors: string[];
}

export const CONTRACTOR_IMPORT_HEADERS = [
  'Delivery Date',
  'Contractor',
  'Customer',
  'Phone',
  'Address',
  'State',
  'Product',
  'Quantity',
  'Amount',
  'Remitted',
] as const;

export function parseContractorSheetRow(
  row: Record<string, unknown>,
  sheetRowIndex: number,
): ContractorParsedRow {
  return {
    rowIndex: sheetRowIndex,
    dateInput: pickHeaderValue(row, 'Delivery Date') || pickHeaderValue(row, 'Date'),
    contractorInput: pickHeaderValue(row, 'Contractor') || pickHeaderValue(row, 'Delivery Manager'),
    customerInput: pickHeaderValue(row, 'Customer') || pickHeaderValue(row, 'Customer Name'),
    phoneInput: pickHeaderValue(row, 'Phone') || pickHeaderValue(row, 'Customer Phone'),
    addressInput: pickHeaderValue(row, 'Address') || pickHeaderValue(row, 'Delivery Address'),
    stateInput: pickHeaderValue(row, 'State'),
    productInput: pickHeaderValue(row, 'Product'),
    quantityInput: pickHeaderValue(row, 'Quantity') || pickHeaderValue(row, 'Qty'),
    amountInput: pickHeaderValue(row, 'Amount') || pickHeaderValue(row, 'Total'),
    remittedInput: pickHeaderValue(row, 'Remitted'),
  };
}

function parseBool(raw: string): boolean {
  const l = raw.toLowerCase().trim();
  return l === 'yes' || l === 'true' || l === 'y' || l === '1' || l === 'remitted';
}

export function makeContractorResolver(products: ProductInfo[]) {
  return function resolveContractorRow(parsed: ContractorParsedRow): ContractorResolvedRow {
    const errors: string[] = [];

    if (!parsed.contractorInput || parsed.contractorInput.trim().length < 2) {
      errors.push('Contractor name is required.');
    }
    if (!parsed.customerInput || parsed.customerInput.trim().length < 2) {
      errors.push('Customer name is required.');
    }
    if (!parsed.phoneInput || parsed.phoneInput.trim().length < 5) {
      errors.push('Customer phone is required.');
    }

    const product = resolveProduct(parsed.productInput, products);
    if (!parsed.productInput.trim()) {
      errors.push('Product is required.');
    } else if (product.unknown) {
      errors.push(`Unknown product "${parsed.productInput}". Pick a valid product.`);
    }

    let quantity = 1;
    const qRaw = parsed.quantityInput.trim();
    if (qRaw) {
      const q = parseInt(qRaw, 10);
      if (!Number.isFinite(q) || q < 1) errors.push('Quantity must be a whole number ≥ 1.');
      else quantity = q;
    }

    const amountProvided = parsed.amountInput.trim() !== '';
    const amount = amountProvided ? parseNumeric(parsed.amountInput) : null;
    if (amountProvided && amount === null) {
      errors.push('Amount must be a number ≥ 0.');
    }

    return {
      ...parsed,
      productId: product.id,
      productName: product.name,
      quantity,
      amount,
      remitted: parseBool(parsed.remittedInput),
      deliveredAtIso: parseExcelDate(parsed.dateInput),
      errors,
    };
  };
}

export function makeEmptyContractorRow(rowIndex: number): ContractorParsedRow {
  return {
    rowIndex,
    dateInput: '',
    contractorInput: '',
    customerInput: '',
    phoneInput: '',
    addressInput: '',
    stateInput: '',
    productInput: '',
    quantityInput: '',
    amountInput: '',
    remittedInput: '',
  };
}
