/**
 * ContractorDeliveryImportPage — bulk import of OFFLINE contractor delivery
 * records. Each row becomes a DELIVERED offline order attributed to a logistics
 * provider so the delivery reaches payroll + the logistics dashboard, even for
 * contractors with no CRM account. Wraps `<ImportBulkData>` with global
 * selectors (branch, product, provider, location) applied to every row.
 */

import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ImportBulkData,
  type ImportColumn,
  importCellInputClass,
} from '~/components/ui/import-bulk-data';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { InlineNotification } from '~/components/ui/inline-notification';
import { useBranchesCatalog } from '~/contexts/branches-catalog-context';
import {
  type ProductInfo,
  type ContractorParsedRow,
  type ContractorResolvedRow,
  CONTRACTOR_IMPORT_HEADERS,
  parseContractorSheetRow,
  makeContractorResolver,
  makeEmptyContractorRow,
} from './contractor-delivery-import-shared';

interface ProviderOption {
  id: string;
  name: string;
}
interface LocationOption {
  id: string;
  name: string;
  providerId?: string | null;
}

export interface ContractorDeliveryImportPageProps {
  products: ProductInfo[];
  providers: ProviderOption[];
  locations: LocationOption[];
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([[...CONTRACTOR_IMPORT_HEADERS]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contractor Deliveries');
  XLSX.writeFile(wb, 'contractor-deliveries-template.xlsx');
}

export function ContractorDeliveryImportPage({
  products,
  providers,
  locations,
}: ContractorDeliveryImportPageProps) {
  const branches = useBranchesCatalog();
  const [selectedBranchId, setSelectedBranchId] = useState(
    branches.length === 1 ? branches[0]!.id : '',
  );
  const [selectedProductId, setSelectedProductId] = useState(
    products.length === 1 ? products[0]!.id : '',
  );
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const resolver = useMemo(() => makeContractorResolver(products), [products]);
  const globalReady = Boolean(selectedBranchId && selectedProductId);

  // Locations filtered to the chosen provider (if any) for a coherent pairing.
  const locationOptions = useMemo(
    () =>
      locations.filter((l) => !selectedProviderId || l.providerId === selectedProviderId),
    [locations, selectedProviderId],
  );

  const columns: ImportColumn<ContractorResolvedRow>[] = useMemo(
    () => [
      {
        header: 'Delivery date',
        headerClassName: 'min-w-[8rem]',
        errorTokens: [],
        errorLabel: 'Delivery date',
        hideErrorInfo: true,
        getDisplayValue: (row) => row.dateInput,
        renderCell: ({ row, disabled, patch }) => (
          <input
            type="text"
            value={row.dateInput}
            onChange={(e) => patch({ dateInput: e.target.value } as Partial<ContractorResolvedRow>)}
            disabled={disabled}
            placeholder="4/29/2026"
            className={importCellInputClass(false)}
          />
        ),
      },
      {
        header: 'Contractor',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['contractor name'],
        errorLabel: 'Contractor',
        getDisplayValue: (row) => row.contractorInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.contractorInput}
            onChange={(e) => patch({ contractorInput: e.target.value } as Partial<ContractorResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Customer',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['customer name'],
        errorLabel: 'Customer',
        getDisplayValue: (row) => row.customerInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.customerInput}
            onChange={(e) => patch({ customerInput: e.target.value } as Partial<ContractorResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Phone',
        headerClassName: 'min-w-[9rem]',
        errorTokens: ['customer phone'],
        errorLabel: 'Phone',
        getDisplayValue: (row) => row.phoneInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.phoneInput}
            onChange={(e) => patch({ phoneInput: e.target.value } as Partial<ContractorResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Product',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['product'],
        errorLabel: 'Product',
        getDisplayValue: (row) => row.productInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.productInput}
            onChange={(e) => patch({ productInput: e.target.value } as Partial<ContractorResolvedRow>)}
            disabled={disabled}
            placeholder={selectedProduct?.name ?? 'Product name'}
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
            onChange={(e) => patch({ quantityInput: e.target.value } as Partial<ContractorResolvedRow>)}
            disabled={disabled}
            placeholder="1"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Amount',
        headerClassName: 'min-w-[7rem]',
        errorTokens: ['amount must be'],
        errorLabel: 'Amount',
        getDisplayValue: (row) => row.amountInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            inputMode="decimal"
            value={row.amountInput}
            onChange={(e) => patch({ amountInput: e.target.value } as Partial<ContractorResolvedRow>)}
            disabled={disabled}
            placeholder="15000"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Remitted',
        headerClassName: 'min-w-[5rem]',
        errorTokens: [],
        errorLabel: 'Remitted',
        hideErrorInfo: true,
        getDisplayValue: (row) => (row.remitted ? 'Yes' : 'No'),
        renderCell: ({ row, disabled, patch }) => (
          <input
            type="checkbox"
            checked={row.remitted}
            onChange={(e) => patch({ remittedInput: e.target.checked ? 'yes' : 'no' } as Partial<ContractorResolvedRow>)}
            disabled={disabled}
            className="h-4 w-4 rounded border-app-border text-brand-600 focus:ring-brand-500"
          />
        ),
      },
    ],
    [selectedProduct],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-app-border bg-app-card p-4 space-y-3">
        <h3 className="text-sm font-medium text-app-fg">Delivery attribution</h3>
        <p className="text-xs text-app-fg-muted">
          Choose the branch and default product, and optionally the 3PL provider and location so
          these deliveries appear on the logistics performance dashboard.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <SearchableSelect
            label="Product"
            labelInfo="Default product for rows that leave the Product cell blank."
            value={selectedProductId}
            onChange={setSelectedProductId}
            options={products.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Select product..."
            searchPlaceholder="Search products..."
            required
          />
          <SearchableSelect
            label="Branch"
            labelInfo="Branch these deliveries belong to."
            value={selectedBranchId}
            onChange={setSelectedBranchId}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            placeholder="Select branch..."
            searchPlaceholder="Search branches..."
            required
          />
          <SearchableSelect
            label="Provider (optional)"
            labelInfo="The 3PL company credited. Needed for the delivery to appear on the dashboard."
            value={selectedProviderId}
            onChange={(v) => {
              setSelectedProviderId(v);
              setSelectedLocationId('');
            }}
            options={providers.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Optional"
            searchPlaceholder="Search providers..."
            clearable
          />
          <SearchableSelect
            label="Location (optional)"
            labelInfo="The provider location. This is the canonical link the dashboard groups by."
            value={selectedLocationId}
            onChange={setSelectedLocationId}
            options={locationOptions.map((l) => ({ value: l.id, label: l.name }))}
            placeholder="Optional"
            searchPlaceholder="Search locations..."
            clearable
          />
        </div>
        {!globalReady && (
          <InlineNotification variant="warning" message="Select a product and branch before importing." />
        )}
        {globalReady && !selectedLocationId && (
          <InlineNotification
            variant="info"
            message="No location selected: deliveries import but appear under the dashboard's Unallocated bucket."
          />
        )}
      </div>

      <ImportBulkData<ContractorParsedRow, ContractorResolvedRow>
        title="Import contractor deliveries"
        description="Upload an Excel or CSV sheet of offline contractor deliveries."
        backHref="/admin/logistics/team"
        backLabel="← Back to logistics"
        resourceLabel="delivery"
        actionPath="/admin/logistics/contractor-deliveries/import"
        actionIntent="importContractorDelivery"
        disableImport={!globalReady}
        maxRows={1000}
        columns={columns}
        downloadTemplate={downloadTemplate}
        parseSheetRow={parseContractorSheetRow}
        resolveRow={resolver}
        makeEmptyRow={makeEmptyContractorRow}
        buildFormData={(row) => {
          const fd = new FormData();
          fd.set('contractorName', row.contractorInput.trim());
          fd.set('customerName', row.customerInput.trim());
          fd.set('customerPhone', row.phoneInput.trim());
          fd.set('branchId', selectedBranchId);
          if (row.deliveredAtIso) fd.set('deliveredAtOverride', row.deliveredAtIso);
          if (row.addressInput.trim()) fd.set('deliveryAddress', row.addressInput.trim());
          if (row.stateInput.trim()) fd.set('deliveryState', row.stateInput.trim());
          if (selectedProviderId) fd.set('logisticsProviderId', selectedProviderId);
          if (selectedLocationId) fd.set('logisticsLocationId', selectedLocationId);
          if (row.remitted) fd.set('remitted', 'true');

          // Resolve the row's product, falling back to the global default.
          const productId = row.productId ?? selectedProductId;
          const unitPrice = row.amount ?? 0;
          fd.set(
            'items',
            JSON.stringify([{ productId, quantity: row.quantity, unitPrice }]),
          );
          if (row.amount != null) fd.set('totalAmount', String(row.amount));
          return fd;
        }}
      />
    </div>
  );
}
