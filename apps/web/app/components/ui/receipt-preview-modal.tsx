import { Modal } from './modal';
import { Button } from './button';

export interface ReceiptPreviewModalProps {
  open: boolean;
  onClose: () => void;
  receiptUrl: string;
  /** Modal heading. Default: "Receipt" */
  title?: string;
  /** Image alt text. Default: "Receipt" */
  imageAlt?: string;
  /** Optional metadata block rendered above the image (amount highlight, etc.) */
  children?: React.ReactNode;
}

/**
 * Shared receipt image preview modal. Renders the receipt inline with a graceful
 * fallback when the URL is not an image, plus an "Open in new tab" escape hatch.
 */
export function ReceiptPreviewModal({
  open,
  onClose,
  receiptUrl,
  title = 'Receipt',
  imageAlt = 'Receipt',
  children,
}: ReceiptPreviewModalProps) {
  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-lg"
      role="dialog"
      contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
    >
      <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
        <h3 className="text-lg font-semibold text-app-fg">{title}</h3>
        <button type="button" onClick={onClose} className="text-app-fg-muted hover:text-app-fg">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
        {children}

        <div className="rounded-lg border border-app-border overflow-hidden bg-app-hover">
          <img
            src={receiptUrl}
            alt={imageAlt}
            className="w-full max-h-[400px] object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              const fallback = (e.target as HTMLImageElement).nextElementSibling;
              if (fallback) (fallback as HTMLElement).style.display = 'flex';
            }}
          />
          <div className="items-center justify-center gap-2 p-8 hidden">
            <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <span className="text-sm text-app-fg-muted">Receipt is not an image file</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-3 border-t border-app-border shrink-0 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <a
          href={receiptUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary btn-sm inline-flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          Open in new tab
        </a>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
