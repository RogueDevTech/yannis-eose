import { useCallback, useEffect, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { FileUpload } from '~/components/ui/file-upload';
import { EmptyState } from '~/components/ui/empty-state';
import { TableActionButton } from '~/components/ui/table-action-button';
import { DateTimeText } from '~/components/ui/date-time-text';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';

interface TaxDocument {
  id: string;
  staffId: string;
  docType: 'TIN_CERTIFICATE' | 'TAX_CARD' | 'PAYE_RECEIPT' | 'TAX_CLEARANCE' | 'OTHER';
  title: string;
  docUrl: string;
  notes: string | null;
  expiresOn: string | null;
  uploadedBy: string;
  createdAt: string;
}

const DOC_TYPE_OPTIONS = [
  { value: 'TIN_CERTIFICATE', label: 'TIN Certificate' },
  { value: 'TAX_CARD', label: 'Tax Card' },
  { value: 'PAYE_RECEIPT', label: 'PAYE Receipt' },
  { value: 'TAX_CLEARANCE', label: 'Tax Clearance' },
  { value: 'OTHER', label: 'Other' },
];

function docTypeLabel(type: TaxDocument['docType']): string {
  return DOC_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

interface TaxDocumentsPanelProps {
  staffId: string;
  /** True when the viewer may upload/delete tax documents (hr.write). */
  canWrite: boolean;
  /**
   * Route path whose action handles the createTaxDocument/deleteTaxDocument
   * intents. Defaults to the staff profile index route for this staff.
   */
  actionPath?: string;
}

/**
 * Staff tax documents (doc §5). HR files TIN certificates, tax cards, PAYE
 * receipts and clearance certs per staff. The file is uploaded to GCS via the
 * shared FileUpload; the stored URL is a direct download link.
 */
export function TaxDocumentsPanel({ staffId, canWrite, actionPath }: TaxDocumentsPanelProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const submitting = fetcher.state !== 'idle';
  // Tax-doc intents live on the staff-profile index route; target it explicitly so
  // the panel works from any child route (e.g. the payroll-history page).
  const action = actionPath ?? `/hr/users/${staffId}?index`;

  const [docs, setDocs] = useState<TaxDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TaxDocument | null>(null);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const url = `${getBrowserApiBaseUrl()}/trpc/hr.listTaxDocuments?input=${encodeURIComponent(
        JSON.stringify({ staffId }),
      )}`;
      const res = await fetch(url, { credentials: 'include' });
      const json = (await res.json()) as { result?: { data?: TaxDocument[] } };
      setDocs(json.result?.data ?? []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  useCloseOnFetcherSuccess(
    fetcher,
    () => {
      setShowAdd(false);
      setUploadedUrl('');
    },
    { intent: 'createTaxDocument' },
  );

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setDeleteTarget(null);
      void loadDocs();
    }
  }, [fetcher.state, fetcher.data, loadDocs]);

  useFetcherToast(fetcher.data, { successMessage: 'Tax document saved' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-app-fg">Tax documents</h3>
        {canWrite ? (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            Add document
          </Button>
        ) : null}
      </div>

      {docs.length === 0 && !loading ? (
        <EmptyState title="No tax documents" description="Uploaded tax documents appear here." />
      ) : (
        <ul className="divide-y divide-app-border rounded-lg border border-app-border">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <a
                  href={doc.docUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-medium text-app-fg hover:underline"
                >
                  {doc.title}
                </a>
                <p className="text-xs text-app-fg-muted">
                  {docTypeLabel(doc.docType)}
                  {doc.expiresOn ? (
                    <>
                      {' · Expires '}
                      <DateTimeText dateOnly={doc.expiresOn} />
                    </>
                  ) : null}
                </p>
                {doc.notes ? <p className="text-xs text-app-fg-muted">{doc.notes}</p> : null}
              </div>
              {canWrite ? (
                <TableActionButton variant="danger" onClick={() => setDeleteTarget(doc)}>
                  Delete
                </TableActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {showAdd ? (
        <Modal open onClose={() => setShowAdd(false)}>
          <fetcher.Form method="post" action={action} className="space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Add tax document</h2>
            <input type="hidden" name="intent" value="createTaxDocument" />
            <input type="hidden" name="staffId" value={staffId} />
            <input type="hidden" name="docUrl" value={uploadedUrl} />
            <FormSelect name="docType" label="Document type" required options={DOC_TYPE_OPTIONS} />
            <TextInput
              name="title"
              label="Title"
              required
              minLength={2}
              maxLength={150}
              placeholder="e.g. 2026 Tax Clearance Certificate"
            />
            <div className="space-y-1">
              <label className="text-sm font-medium text-app-fg">
                File <span className="text-danger-500">*</span>
              </label>
              <FileUpload
                folder="tax-docs"
                accept="image/*,application/pdf"
                onUpload={setUploadedUrl}
                label="Upload document (PDF or image, ≤10MB)"
              />
            </div>
            <TextInput name="notes" label="Notes (optional)" maxLength={1000} />
            <TextInput name="expiresOn" label="Expiry date (optional)" type="date" />
            {fetcher.data?.error ? (
              <p className="text-sm text-danger-600 dark:text-danger-400">{fetcher.data.error}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !uploadedUrl}>
                {submitting ? 'Saving…' : 'Add document'}
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      ) : null}

      <ConfirmActionModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete tax document"
        description={
          deleteTarget
            ? `Delete "${deleteTarget.title}"? The file record is removed (history is retained).`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        loading={fetcher.state === 'submitting'}
        onConfirm={() => {
          if (!deleteTarget) return;
          fetcher.submit(
            { intent: 'deleteTaxDocument', documentId: deleteTarget.id },
            { method: 'post', action },
          );
        }}
      />
    </div>
  );
}
