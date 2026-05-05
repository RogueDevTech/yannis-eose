import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { InvoiceDocumentPreview } from '~/components/ui/invoice-document-preview';
import type { InvoicePdfRowSource } from '~/lib/invoice-pdf';

export function InvoicePreviewModal({
  invoice,
  onClose,
}: {
  invoice: InvoicePdfRowSource | null;
  onClose: () => void;
}) {
  if (!invoice) return null;

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-3xl"
      backdropBlur
      contentClassName="p-0 flex flex-col max-h-[92dvh] overflow-hidden border border-app-border bg-app-elevated shadow-xl"
      aria-labelledby="invoice-preview-title"
    >
      <div className="flex items-center justify-between gap-3 border-b border-app-border px-4 py-3 shrink-0">
        <h2 id="invoice-preview-title" className="truncate pr-2 text-base font-semibold text-app-fg">
          View · <span className="font-mono font-normal">{invoice.referenceFormatted}</span>
        </h2>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <InvoiceDocumentPreview invoice={invoice} />
      </div>
    </Modal>
  );
}
