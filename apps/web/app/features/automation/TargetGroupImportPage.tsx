import { useMemo } from 'react';
import { ImportBulkData, type ImportColumn, importCellInputClass } from '~/components/ui/import-bulk-data';
import { pickHeaderValue } from '~/features/products/products-import-shared';

interface ParsedRow {
  rowIndex: number;
  name: string;
  phone: string;
  email: string;
}
interface ResolvedRow extends ParsedRow {
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveRow(p: ParsedRow): ResolvedRow {
  const errors: string[] = [];
  const phone = p.phone.trim();
  const email = p.email.trim();
  if (!phone && !email) errors.push('needs a phone or an email');
  if (email && !EMAIL_RE.test(email)) errors.push('invalid email');
  return { ...p, errors };
}

/**
 * Bulk-import members into a Target Group from a CSV/Excel file. Columns: name,
 * phone, email. The server hashes the phone and stores only the hash + name/email
 * (raw phone is never persisted — Lead Fortress). One POST per row.
 */
export function TargetGroupImportPage({ groupId, groupName }: { groupId: string; groupName: string }) {
  const columns: ImportColumn<ResolvedRow>[] = useMemo(
    () => [
      {
        header: 'Name',
        headerClassName: 'min-w-[12rem]',
        errorTokens: [],
        errorLabel: 'Name',
        getDisplayValue: (r) => r.name,
        renderCell: ({ row, disabled, patch }) => (
          <input
            type="text"
            value={row.name}
            onChange={(e) => patch({ name: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="Customer name"
            className={importCellInputClass(false)}
          />
        ),
      },
      {
        header: 'Phone',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['phone'],
        errorLabel: 'Phone',
        getDisplayValue: (r) => r.phone,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.phone}
            onChange={(e) => patch({ phone: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="08012345678"
            aria-invalid={errored || undefined}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Email',
        headerClassName: 'min-w-[12rem]',
        errorTokens: ['email'],
        errorLabel: 'Email',
        getDisplayValue: (r) => r.email,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.email}
            onChange={(e) => patch({ email: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="customer@example.com"
            aria-invalid={errored || undefined}
            className={importCellInputClass(errored)}
          />
        ),
      },
    ],
    [],
  );

  return (
    <ImportBulkData<ParsedRow, ResolvedRow>
      title={`Import members: ${groupName}`}
      description="Upload a CSV or Excel file of customers. Phones are hashed on import; raw phone numbers are never stored."
      backHref="/admin/marketing/automation"
      backLabel="← Back to automation"
      resourceLabel="member"
      actionPath="/admin/marketing/automation?index"
      actionIntent="importMember"
      maxRows={2000}
      columns={columns}
      parseSheetRow={(row, sheetRowIndex) => ({
        rowIndex: sheetRowIndex,
        name: pickHeaderValue(row, 'name'),
        phone: pickHeaderValue(row, 'phone'),
        email: pickHeaderValue(row, 'email'),
      })}
      resolveRow={resolveRow}
      makeEmptyRow={(sheetRowIndex) => ({ rowIndex: sheetRowIndex, name: '', phone: '', email: '' })}
      buildFormData={(row) => {
        const fd = new FormData();
        fd.set('groupId', groupId);
        if (row.name.trim()) fd.set('name', row.name.trim());
        if (row.phone.trim()) fd.set('phone', row.phone.trim());
        if (row.email.trim()) fd.set('email', row.email.trim());
        return fd;
      }}
      referenceContent={
        <p className="text-xs text-app-fg-muted">
          Columns: <code>name</code>, <code>phone</code>, <code>email</code>. Each row needs a phone or an email.
          Members imported without a phone can be reached by email only.
        </p>
      }
      redirectOnComplete
    />
  );
}
