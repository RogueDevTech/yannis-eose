/**
 * OrdersImportPage — bulk import of orders from an external CRM export.
 * SuperAdmin-only. Wraps `<ImportBulkData>` with global assignment selectors
 * (branch, media buyer, CS agent) applied to every imported row.
 */

import { useMemo, useState } from 'react';
import {
  ImportBulkData,
  type ImportColumn,
  importCellInputClass,
} from '~/components/ui/import-bulk-data';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { InlineNotification } from '~/components/ui/inline-notification';
import {
  type ProductInfo,
  type ParsedRow,
  type ResolvedRow,
  makeEmptyParsedRow,
  pickHeaderValue,
  resolveRow,
} from './orders-import-shared';
import { downloadOrdersImportTemplate } from './orders-import-template';

interface UserOption {
  id: string;
  name: string;
  role: string;
}

interface BranchOption {
  id: string;
  name: string;
}

export interface OrdersImportPageProps {
  products: ProductInfo[];
  mediaBuyers: UserOption[];
  csAgents: UserOption[];
  branches: BranchOption[];
}

export function OrdersImportPage({
  products,
  mediaBuyers,
  csAgents,
  branches,
}: OrdersImportPageProps) {
  const [selectedBranchId, setSelectedBranchId] = useState(
    branches.length === 1 ? branches[0].id : '',
  );
  const [selectedMbId, setSelectedMbId] = useState('');
  const [selectedCsId, setSelectedCsId] = useState('');
  const [selectedProductId, setSelectedProductId] = useState(
    products.length === 1 ? products[0].id : '',
  );

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const globalReady = selectedBranchId && selectedCsId && selectedProductId;

  const columns: ImportColumn<ResolvedRow>[] = useMemo(
    () => [
      {
        header: 'Date',
        headerClassName: 'min-w-[8rem]',
        errorTokens: [],
        errorLabel: 'Date',
        hideErrorInfo: true,
        getDisplayValue: (row) => row.dateInput,
        renderCell: ({ row, disabled, patch }) => (
          <input
            type="text"
            value={row.dateInput}
            onChange={(e) => patch({ dateInput: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="4/29/2026"
            className={importCellInputClass(false)}
          />
        ),
      },
      {
        header: 'Name',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['name must be'],
        errorLabel: 'Name',
        getDisplayValue: (row) => row.name,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.name}
            onChange={(e) => patch({ name: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Phone',
        headerClassName: 'min-w-[9rem]',
        errorTokens: ['phone'],
        errorLabel: 'Phone',
        getDisplayValue: (row) => row.phoneInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.phoneInput}
            onChange={(e) => patch({ phoneInput: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Qty',
        headerClassName: 'min-w-[4rem]',
        errorTokens: ['quantity'],
        errorLabel: 'Quantity',
        getDisplayValue: (row) => row.quantityInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            inputMode="numeric"
            value={row.quantityInput}
            onChange={(e) => patch({ quantityInput: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="1"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Cost',
        headerClassName: 'min-w-[7rem]',
        errorTokens: ['cost must be'],
        errorLabel: 'Cost',
        getDisplayValue: (row) => row.costInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            inputMode="decimal"
            value={row.costInput}
            onChange={(e) => patch({ costInput: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="100000"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Status',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['status'],
        errorLabel: 'Status',
        getDisplayValue: (row) => row.statusInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.statusInput}
            onChange={(e) => patch({ statusInput: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="Pending"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Address',
        headerClassName: 'min-w-[12rem]',
        errorTokens: [],
        errorLabel: 'Address',
        hideErrorInfo: true,
        getDisplayValue: (row) => row.addressInput,
        renderCell: ({ row, disabled, patch }) => (
          <input
            type="text"
            value={row.addressInput}
            onChange={(e) => patch({ addressInput: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(false)}
          />
        ),
      },
      {
        header: 'State',
        headerClassName: 'min-w-[6rem]',
        errorTokens: [],
        errorLabel: 'State',
        hideErrorInfo: true,
        getDisplayValue: (row) => row.stateInput,
        renderCell: ({ row, disabled, patch }) => (
          <input
            type="text"
            value={row.stateInput}
            onChange={(e) => patch({ stateInput: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(false)}
          />
        ),
      },
      {
        header: 'Email',
        headerClassName: 'min-w-[10rem]',
        errorTokens: [],
        errorLabel: 'Email',
        hideErrorInfo: true,
        getDisplayValue: (row) => row.emailInput,
        renderCell: ({ row, disabled, patch }) => (
          <input
            type="text"
            value={row.emailInput}
            onChange={(e) => patch({ emailInput: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(false)}
          />
        ),
      },
      {
        header: 'Gender',
        headerClassName: 'min-w-[5rem]',
        errorTokens: [],
        errorLabel: 'Gender',
        hideErrorInfo: true,
        getDisplayValue: (row) => row.genderInput,
        renderCell: ({ row, disabled, patch }) => (
          <input
            type="text"
            value={row.genderInput}
            onChange={(e) => patch({ genderInput: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(false)}
          />
        ),
      },
      {
        header: 'Details',
        headerClassName: 'min-w-[10rem]',
        errorTokens: [],
        errorLabel: 'More details',
        hideErrorInfo: true,
        getDisplayValue: (row) => row.moreDetailsInput,
        renderCell: ({ row, disabled, patch }) => (
          <input
            type="text"
            value={row.moreDetailsInput}
            onChange={(e) => patch({ moreDetailsInput: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(false)}
          />
        ),
      },
    ],
    [products],
  );

  return (
    <div className="space-y-4">
      {/* Global assignment selectors — applied to every imported row */}
      <div className="rounded-lg border border-app-border bg-app-card p-4 space-y-3">
        <h3 className="text-sm font-medium text-app-fg">Batch assignment</h3>
        <p className="text-xs text-app-fg-muted">
          Select the product, branch, media buyer, and CS agent for all imported orders.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <SearchableSelect
            label="Product"
            value={selectedProductId}
            onChange={setSelectedProductId}
            options={products.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Select product..."
            searchPlaceholder="Search products..."
            required
          />
          <SearchableSelect
            label="Branch"
            value={selectedBranchId}
            onChange={setSelectedBranchId}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            placeholder="Select branch..."
            searchPlaceholder="Search branches..."
            required
          />
          <SearchableSelect
            label="Media Buyer"
            value={selectedMbId}
            onChange={setSelectedMbId}
            options={mediaBuyers.map((u) => ({ value: u.id, label: u.name }))}
            placeholder="— Optional —"
            searchPlaceholder="Search media buyers..."
            clearable
          />
          <SearchableSelect
            label="CS Agent"
            value={selectedCsId}
            onChange={setSelectedCsId}
            options={csAgents.map((u) => ({ value: u.id, label: u.name }))}
            placeholder="Select CS agent..."
            searchPlaceholder="Search CS agents..."
            required
          />
        </div>
        {!globalReady && (
          <InlineNotification variant="warning">
            Select a product, branch, and CS agent before importing.
          </InlineNotification>
        )}
      </div>

      <ImportBulkData<ParsedRow, ResolvedRow>
        title="Import orders"
        description="Upload a CRM export spreadsheet to import historical orders."
        backHref="/admin/sales/orders"
        backLabel="← Back to orders"
        resourceLabel="order"
        actionPath="/admin/sales/orders/import"
        actionIntent="importOrder"
        maxRows={1000}
        columns={columns}
        parseSheetRow={(row, sheetRowIndex) => ({
          rowIndex: sheetRowIndex,
          dateInput: pickHeaderValue(row, 'date'),
          name: pickHeaderValue(row, 'name'),
          phoneInput: pickHeaderValue(row, 'phone_number'),
          whatsappInput: pickHeaderValue(row, 'whatsapp_number'),
          emailInput: pickHeaderValue(row, 'email'),
          addressInput: pickHeaderValue(row, 'address'),
          stateInput: pickHeaderValue(row, 'state'),
          productInput: pickHeaderValue(row, 'product_name'),
          unitInput: pickHeaderValue(row, 'unit'),
          quantityInput: pickHeaderValue(row, 'quantity'),
          costInput: pickHeaderValue(row, 'cost'),
          genderInput: pickHeaderValue(row, 'gender'),
          deliveryTimeInput: pickHeaderValue(row, 'delivery_time'),
          moreDetailsInput: pickHeaderValue(row, 'more_details'),
          statusInput: pickHeaderValue(row, 'status'),
          mediaBuyerInput: pickHeaderValue(row, 'media_buyer'),
          csInput: pickHeaderValue(row, 'cs'),
          deliveryAgentInput: pickHeaderValue(row, 'delivery_agent'),
          comment1Input: pickHeaderValue(row, 'comment_1'),
          comment2Input: pickHeaderValue(row, 'comment_2'),
          comment3Input: pickHeaderValue(row, 'comment_3'),
        })}
        resolveRow={(parsed) => resolveRow(parsed)}
        makeEmptyRow={(sheetRowIndex) => makeEmptyParsedRow(sheetRowIndex)}
        buildFormData={(row) => {
          const fd = new FormData();
          fd.set('customerName', row.name);
          fd.set('customerPhone', row.phoneInput);
          fd.set('branchId', selectedBranchId);
          fd.set('assignedCsId', selectedCsId);
          if (selectedMbId) fd.set('mediaBuyerId', selectedMbId);
          if (row.targetStatus) fd.set('targetStatus', row.targetStatus);
          if (row.createdAtIso) fd.set('createdAtOverride', row.createdAtIso);
          if (row.addressInput) {
            fd.set('customerAddress', row.addressInput);
            fd.set('deliveryAddress', row.addressInput);
          }
          if (row.stateInput) fd.set('deliveryState', row.stateInput);
          if (row.emailInput) fd.set('customerEmail', row.emailInput);
          if (row.genderInput) fd.set('customerGender', row.genderInput);
          if (row.moreDetailsInput) fd.set('deliveryNotes', row.moreDetailsInput);

          // Items — single item from the globally selected product
          if (selectedProductId) {
            const items = [
              {
                productId: selectedProductId,
                quantity: row.quantity,
                unitPrice: row.cost ?? 0,
              },
            ];
            fd.set('items', JSON.stringify(items));
          }
          if (row.cost != null) fd.set('totalAmount', String(row.cost));

          // Custom fields — preserve CRM metadata for reference
          const customFields: Record<string, string> = {};
          if (row.whatsappInput) customFields.whatsappNumber = row.whatsappInput;
          if (row.unitInput) customFields.unit = row.unitInput;
          if (row.deliveryTimeInput) customFields.deliveryTime = row.deliveryTimeInput;
          if (row.mediaBuyerInput) customFields.importMediaBuyer = row.mediaBuyerInput;
          if (row.csInput) customFields.importCS = row.csInput;
          if (row.deliveryAgentInput) customFields.importDeliveryAgent = row.deliveryAgentInput;
          const comments = [row.comment1Input, row.comment2Input, row.comment3Input]
            .filter(Boolean)
            .join(' | ');
          if (comments) customFields.importComments = comments;
          if (Object.keys(customFields).length > 0) {
            fd.set('customFields', JSON.stringify(customFields));
          }

          return fd;
        }}
        downloadTemplate={() => downloadOrdersImportTemplate()}
        redirectOnComplete
      />
    </div>
  );
}
