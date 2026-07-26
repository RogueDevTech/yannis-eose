import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { PayslipDocumentPreview } from '~/components/ui/payslip-document-preview';
import type { PayslipPdfInput } from '~/lib/payslip-pdf';

export function PayslipPreviewModal({
  payslip,
  title,
  downloading,
  onDownload,
  onClose,
}: {
  payslip: PayslipPdfInput | null;
  title?: string;
  downloading?: boolean;
  onDownload?: () => void;
  onClose: () => void;
}) {
  if (!payslip) return null;

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-3xl"
      backdropBlur
      contentClassName="p-0 flex flex-col max-h-[92dvh] overflow-hidden border border-app-border bg-app-elevated shadow-xl"
      aria-labelledby="payslip-preview-title"
    >
      <div className="flex items-center justify-between gap-3 border-b border-app-border px-4 py-3 shrink-0">
        <h2 id="payslip-preview-title" className="truncate pr-2 text-base font-semibold text-app-fg">
          {title ?? `View · ${payslip.periodLabel}`}
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          {onDownload ? (
            <Button type="button" variant="primary" size="sm" disabled={downloading} onClick={onDownload}>
              {downloading ? 'Generating…' : 'Download PDF'}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-100 p-4 sm:p-5 dark:bg-neutral-900/40">
        <PayslipDocumentPreview payslip={payslip} />
      </div>
    </Modal>
  );
}
