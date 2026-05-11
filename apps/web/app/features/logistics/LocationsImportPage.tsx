/**
 * LocationsImportPage — thin column-config wrapper around `<ImportBulkData>`,
 * mounted at `/admin/logistics/partners/import-locations`. Each location must
 * reference an existing 3PL provider by name (or UUID); the resolver matches
 * the cell against the live providers list and surfaces an inline error when
 * no provider is found.
 */

import { useMemo } from 'react';
import {
  ImportBulkData,
  type ImportColumn,
  importCellInputClass,
} from '~/components/ui/import-bulk-data';
import {
  type ParsedRow,
  type ProviderInfo,
  type ResolvedRow,
  makeEmptyParsedRow,
  pickHeaderValue,
  resolveRow,
} from './locations-import-shared';
import { LocationsImportColumnsReference } from './LocationsImportColumnsReference';
import { downloadLocationsImportTemplate } from './locations-import-template';

interface LocationsImportPageProps {
  providers: ProviderInfo[];
}

export function LocationsImportPage({ providers }: LocationsImportPageProps) {
  const columns: ImportColumn<ResolvedRow>[] = useMemo(
    () => [
      {
        header: 'Provider',
        headerClassName: 'min-w-[12rem]',
        errorTokens: ['provider', 'unknown provider'],
        errorLabel: 'Provider',
        getDisplayValue: (row) => row.providerInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <select
            value={row.providerId ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              const provider = providers.find((p) => p.id === id);
              patch({ providerInput: provider?.name ?? '' } as Partial<ResolvedRow>);
            }}
            disabled={disabled || providers.length === 0}
            className={importCellInputClass(errored)}
          >
            <option value="">— Pick provider —</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
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
            placeholder="Lekki hub"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Address',
        headerClassName: 'min-w-[18rem]',
        errorTokens: ['address must be'],
        errorLabel: 'Address',
        getDisplayValue: (row) => row.address,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.address}
            onChange={(e) => patch({ address: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="Street, area, city"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Coordinates',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['coordinates must be'],
        errorLabel: 'Coordinates',
        getDisplayValue: (row) => row.coordinates,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.coordinates}
            onChange={(e) => patch({ coordinates: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="6.4426,3.4525"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'WhatsApp link',
        headerClassName: 'min-w-[14rem]',
        errorTokens: ['whatsapp group link'],
        errorLabel: 'WhatsApp group link',
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
    [providers],
  );

  return (
    <ImportBulkData<ParsedRow, ResolvedRow>
      title="Import logistics locations"
      description="Upload a spreadsheet of pickup / dispatch locations, fix any rows the editor flags, then import. Each location must reference an existing 3PL company."
      backHref="/admin/logistics/partners"
      backLabel="← Back to partners"
      resourceLabel="location"
      actionPath="/admin/logistics/partners?index"
      actionIntent="importLocation"
      maxRows={500}
      columns={columns}
      parseSheetRow={(row, sheetRowIndex) => ({
        rowIndex: sheetRowIndex,
        providerInput: pickHeaderValue(row, 'provider'),
        name: pickHeaderValue(row, 'name'),
        address: pickHeaderValue(row, 'address'),
        coordinates: pickHeaderValue(row, 'coordinates'),
        whatsappGroupLink: pickHeaderValue(row, 'whatsapp_group_link'),
      })}
      resolveRow={(parsed) => resolveRow(parsed, providers)}
      makeEmptyRow={(sheetRowIndex) => makeEmptyParsedRow(sheetRowIndex)}
      buildFormData={(row) => {
        const fd = new FormData();
        fd.set('providerId', row.providerId as string);
        fd.set('name', row.name);
        fd.set('address', row.address);
        if (row.coordinates) fd.set('coordinates', row.coordinates);
        if (row.whatsappGroupLink) fd.set('whatsappGroupLink', row.whatsappGroupLink);
        return fd;
      }}
      downloadTemplate={() => downloadLocationsImportTemplate(providers)}
      downloadTemplateDisabled={providers.length === 0}
      referenceContent={<LocationsImportColumnsReference providers={providers} />}
      redirectOnComplete
    />
  );
}
