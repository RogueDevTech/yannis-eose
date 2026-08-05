import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { BankPayDocumentPreview } from '~/components/ui/bank-pay-document-preview';
import type { BankPayPdfInput } from '~/lib/bank-pay-pdf';

export function BankPayPreviewModal({
  doc,
  title,
  downloading,
  downloadLabel = 'Download PDF',
  onDownload,
  onClose,
}: {
  doc: BankPayPdfInput | null;
  title?: string;
  downloading?: boolean;
  downloadLabel?: string;
  onDownload?: () => void;
  onClose: () => void;
}) {
  if (!doc) return null;

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-7xl"
      backdropBlur
      contentClassName="p-0 flex flex-col max-h-[92dvh] overflow-hidden border border-app-border bg-app-elevated shadow-xl"
      aria-labelledby="bank-pay-preview-title"
    >
      <div className="flex items-center justify-between gap-3 border-b border-app-border px-4 py-3 shrink-0">
        <h2 id="bank-pay-preview-title" className="truncate pr-2 text-base font-semibold text-app-fg">
          {title ?? 'Bank pay list'}
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          {onDownload ? (
            <Button type="button" variant="primary" size="sm" disabled={downloading} onClick={onDownload}>
              {downloading ? 'Generating…' : downloadLabel}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-100 p-4 sm:p-5 dark:bg-neutral-900/40">
        <BankPayDocumentPreview doc={doc} />
      </div>
    </Modal>
  );
}
