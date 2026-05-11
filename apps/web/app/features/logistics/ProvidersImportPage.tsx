/**
 * ProvidersImportPage — thin column-config wrapper around `<ImportBulkData>`,
 * mounted at `/admin/logistics/partners/import-providers`. The per-row import
 * action lives on the partners route (`intent=importProvider`) so the same
 * permission gate, RLS, and audit triggers apply.
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
  makeEmptyParsedRow,
  pickHeaderValue,
  resolveRow,
} from './providers-import-shared';
import { ProvidersImportColumnsReference } from './ProvidersImportColumnsReference';
import { downloadProvidersImportTemplate } from './providers-import-template';

export function ProvidersImportPage() {
  const columns: ImportColumn<ResolvedRow>[] = useMemo(
    () => [
      {
        header: 'Name',
        headerClassName: 'min-w-[12rem]',
        errorTokens: ['name must be'],
        errorLabel: 'Name',
        getDisplayValue: (row) => row.name,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.name}
            onChange={(e) => patch({ name: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="GIG Logistics"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Contact info',
        headerClassName: 'min-w-[18rem]',
        errorTokens: ['contact info'],
        errorLabel: 'Contact info',
        getDisplayValue: (row) => row.contactInfo,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.contactInfo}
            onChange={(e) =>
              patch({ contactInfo: e.target.value } as Partial<ResolvedRow>)
            }
            disabled={disabled}
            placeholder="email · phone"
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Coverage area',
        headerClassName: 'min-w-[16rem]',
        errorTokens: ['coverage area'],
        errorLabel: 'Coverage area',
        getDisplayValue: (row) => row.coverageArea,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.coverageArea}
            onChange={(e) =>
              patch({ coverageArea: e.target.value } as Partial<ResolvedRow>)
            }
            disabled={disabled}
            placeholder="Lagos, Ogun · Nigeria-wide"
            className={importCellInputClass(errored)}
          />
        ),
      },
    ],
    [],
  );

  return (
    <ImportBulkData<ParsedRow, ResolvedRow>
      title="Import logistics companies"
      description="Upload a spreadsheet of 3PL companies, fix any rows the editor flags, then import. Each row is created one at a time so a single bad row doesn't block the rest."
      backHref="/admin/logistics/partners"
      backLabel="← Back to partners"
      resourceLabel="company"
      actionPath="/admin/logistics/partners?index"
      actionIntent="importProvider"
      maxRows={500}
      columns={columns}
      parseSheetRow={(row, sheetRowIndex) => ({
        rowIndex: sheetRowIndex,
        name: pickHeaderValue(row, 'name'),
        contactInfo: pickHeaderValue(row, 'contact_info'),
        coverageArea: pickHeaderValue(row, 'coverage_area'),
      })}
      resolveRow={(parsed) => resolveRow(parsed)}
      makeEmptyRow={(sheetRowIndex) => makeEmptyParsedRow(sheetRowIndex)}
      buildFormData={(row) => {
        const fd = new FormData();
        fd.set('name', row.name);
        fd.set('contactInfo', row.contactInfo);
        fd.set('coverageArea', row.coverageArea);
        return fd;
      }}
      downloadTemplate={downloadProvidersImportTemplate}
      referenceContent={<ProvidersImportColumnsReference />}
      redirectOnComplete
    />
  );
}
