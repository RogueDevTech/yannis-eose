/**
 * CombinedImportPage — single-upload import for providers + locations.
 *
 * One spreadsheet row = one location under a provider. Providers are
 * find-or-created idempotently on the server: rows sharing the same provider
 * name group together, the provider is created once, and each location is
 * linked to it.
 *
 * Accepts the Head of Logistics' existing format:
 *   Provider | Name (coverage area) | (phone) | Address (phone) | WhatsApp Group Link
 *
 * Also accepts the canonical template format:
 *   Provider | Coverage Area | Contact Phone | Location Name | Location Address | WhatsApp Group Link
 */

import { useMemo } from 'react';
import {
  ImportBulkData,
  type ImportColumn,
  importCellInputClass,
} from '~/components/ui/import-bulk-data';
import {
  type ParsedRow,
  type ResolvedRow,
  type ProviderInfo,
  NIGERIAN_STATES,
  makeEmptyParsedRow,
  pickHeaderValue,
  cleanPhone,
  resolveRow,
} from './combined-import-shared';
import { FormSelect } from '~/components/ui/form-select';
import { CombinedImportColumnsReference } from './CombinedImportColumnsReference';
import { downloadCombinedImportTemplate } from './combined-import-template';

interface CombinedImportPageProps {
  providers: ProviderInfo[];
}

/**
 * Smart sheet-row parser that handles both the HoL's existing format and the
 * canonical template format.
 *
 * HoL format:  Provider | Name(=coverage) | (blank col) | Address(=phone) | WhatsApp Group Link
 * Template:    Provider | Coverage Area | Contact Phone | Location Name | Location Address | WhatsApp Group Link
 */
function parseSheetRow(row: Record<string, unknown>, sheetRowIndex: number): ParsedRow {
  // Try canonical headers first
  let providerName = pickHeaderValue(row, 'provider');
  let coverageArea = pickHeaderValue(row, 'coverage_area');
  let contactPhone = pickHeaderValue(row, 'contact_phone');
  let locationName = pickHeaderValue(row, 'location_name');
  let locationAddress = pickHeaderValue(row, 'location_address');
  let whatsappGroupLink = pickHeaderValue(row, 'whatsapp_group_link');

  // Fallback: HoL's format — "Name" column is actually coverage area
  if (!coverageArea) {
    coverageArea = pickHeaderValue(row, 'name');
    // If "name" was used as coverage, don't also use it as location name
    if (coverageArea && !locationName) locationName = '';
  }

  // Fallback: "Address" column in HoL's format is actually the phone number
  if (!contactPhone) {
    const addressVal = pickHeaderValue(row, 'address');
    // Heuristic: if "address" looks like a phone number (starts with digits, 234..., or +234...)
    if (addressVal && /^[+=]?\d/.test(addressVal.replace(/\s/g, ''))) {
      contactPhone = addressVal;
    } else if (addressVal) {
      // It's a real address
      if (!locationAddress) locationAddress = addressVal;
    }
  }

  // Clean phone values from Excel artifacts
  contactPhone = cleanPhone(contactPhone);

  // State — try "State" header first
  const state = pickHeaderValue(row, 'state');

  return {
    rowIndex: sheetRowIndex,
    providerName,
    contactPhone,
    coverageArea,
    locationName,
    locationAddress,
    state,
    whatsappGroupLink,
  };
}

export function CombinedImportPage({ providers }: CombinedImportPageProps) {
  const columns: ImportColumn<ResolvedRow>[] = useMemo(
    () => [
      {
        header: 'Provider',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['provider name'],
        errorLabel: 'Provider',
        getDisplayValue: (row) => row.providerName,
        renderCell: ({ row, disabled, errored, patch }) => (
          <div className="space-y-0.5">
            <input
              type="text"
              value={row.providerName}
              onChange={(e) => patch({ providerName: e.target.value } as Partial<ResolvedRow>)}
              disabled={disabled}
              placeholder="Olaasiyah"
              className={importCellInputClass(errored)}
            />
            {row.providerName && !errored ? (
              <span className={`text-micro block ${row.providerExists ? 'text-brand-600 dark:text-brand-400' : 'text-success-600 dark:text-success-400'}`}>
                {row.providerExists ? 'Existing' : '+ New'}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        header: 'Coverage area',
        headerClassName: 'min-w-[12rem]',
        errorTokens: ['coverage area'],
        errorLabel: 'Coverage Area',
        getDisplayValue: (row) => row.coverageArea,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.coverageArea}
            onChange={(e) => patch({ coverageArea: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="Lagos"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Contact phone',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['contact phone'],
        errorLabel: 'Contact Phone',
        getDisplayValue: (row) => row.contactPhone,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.contactPhone}
            onChange={(e) => patch({ contactPhone: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="2347067737784"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Location name',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['location name'],
        errorLabel: 'Location Name',
        getDisplayValue: (row) => row.locationName,
        renderCell: ({ row, disabled, errored, patch }) => (
          <div className="space-y-0.5">
            <input
              type="text"
              value={row.locationName}
              onChange={(e) => patch({ locationName: e.target.value } as Partial<ResolvedRow>)}
              disabled={disabled}
              placeholder="(defaults to coverage area)"
              className={importCellInputClass(errored)}
            />
            {!row.locationName && row.coverageArea ? (
              <span className="text-micro text-app-fg-muted block truncate">
                → {row.coverageArea}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        header: 'Location address',
        headerClassName: 'min-w-[12rem]',
        errorTokens: ['location address', 'address must be'],
        errorLabel: 'Location Address',
        getDisplayValue: (row) => row.locationAddress,
        renderCell: ({ row, disabled, errored, patch }) => (
          <div className="space-y-0.5">
            <input
              type="text"
              value={row.locationAddress}
              onChange={(e) => patch({ locationAddress: e.target.value } as Partial<ResolvedRow>)}
              disabled={disabled}
              placeholder="(defaults to coverage area)"
              className={importCellInputClass(errored)}
            />
            {!row.locationAddress && row.coverageArea ? (
              <span className="text-micro text-app-fg-muted block truncate">
                → {row.coverageArea}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        header: 'State',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['state'],
        errorLabel: 'State',
        getDisplayValue: (row) => row.state,
        renderCell: ({ row, disabled, errored, patch }) => (
          <FormSelect
            value={row.state}
            onChange={(e) => patch({ state: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="— Select state —"
            options={NIGERIAN_STATES.map((s) => ({ value: s, label: s }))}
            controlSize="sm"
            wrapperClassName="w-full"
            className={[
              '!bg-app-elevated !text-xs max-sm:!text-sm max-sm:!py-2 max-sm:!rounded-lg',
              errored
                ? '!border-danger-400 focus:!border-danger-500 focus:!ring-danger-500'
                : '!border-app-border focus:!border-brand-500 focus:!ring-brand-500',
            ].join(' ')}
          />
        ),
      },
      {
        header: 'WhatsApp link',
        headerClassName: 'min-w-[14rem]',
        errorTokens: ['whatsapp group link'],
        errorLabel: 'WhatsApp Group Link',
        getDisplayValue: (row) => row.whatsappGroupLink,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="url"
            value={row.whatsappGroupLink}
            onChange={(e) =>
              patch({ whatsappGroupLink: e.target.value } as Partial<ResolvedRow>)
            }
            disabled={disabled}
            placeholder="https://chat.whatsapp.com/…"
            className={importCellInputClass(errored)}
          />
        ),
      },
    ],
    [],
  );

  return (
    <ImportBulkData<ParsedRow, ResolvedRow>
      title="Import providers & locations"
      description="Upload one spreadsheet to create providers and their locations in a single step. Existing providers are matched by name — no duplicates."
      backHref="/admin/logistics/partners"
      backLabel="← Back to partners"
      resourceLabel="row"
      actionPath="/admin/logistics/partners?index"
      actionIntent="importCombined"
      maxRows={500}
      columns={columns}
      parseSheetRow={parseSheetRow}
      resolveRow={(parsed) => resolveRow(parsed, providers)}
      makeEmptyRow={(sheetRowIndex) => makeEmptyParsedRow(sheetRowIndex)}
      buildFormData={(row) => {
        const fd = new FormData();
        fd.set('providerName', row.providerName);
        fd.set('contactPhone', row.contactPhone);
        fd.set('coverageArea', row.coverageArea);
        // Send effective values (with fallbacks applied)
        fd.set('locationName', row.locationName || row.coverageArea);
        fd.set('locationAddress', row.locationAddress || row.coverageArea);
        fd.set('state', row.state);
        if (row.whatsappGroupLink) fd.set('whatsappGroupLink', row.whatsappGroupLink);
        if (row.existingProviderId) fd.set('existingProviderId', row.existingProviderId);
        return fd;
      }}
      downloadTemplate={downloadCombinedImportTemplate}
      referenceContent={<CombinedImportColumnsReference />}
      redirectOnComplete
    />
  );
}
