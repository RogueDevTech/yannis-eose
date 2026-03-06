import { Button } from '~/components/ui/button';

export type ConfirmVariant = 'danger' | 'warning' | 'archive';

export interface ConfirmActionModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void;
  loading?: boolean;
  /** Optional extra content (e.g. bullet list of consequences) */
  details?: React.ReactNode;
  /** Optional error message to show above buttons */
  error?: string | null;
}

const VARIANT_STYLES: Record<
  ConfirmVariant,
  { border: string; iconBg: string; iconColor: string; titleColor: string; detailsBox: string; borderBottom: string }
> = {
  danger: {
    border: 'border-2 border-danger-200 dark:border-danger-800',
    iconBg: 'bg-danger-100 dark:bg-danger-900/50',
    iconColor: 'text-danger-600 dark:text-danger-400',
    titleColor: 'text-danger-700 dark:text-danger-300',
    detailsBox: 'bg-danger-50 dark:bg-danger-900/20 border-danger-200 dark:border-danger-800',
    borderBottom: 'border-danger-100 dark:border-danger-900/50',
  },
  warning: {
    border: 'border-2 border-warning-200 dark:border-warning-800',
    iconBg: 'bg-warning-100 dark:bg-warning-900/50',
    iconColor: 'text-warning-600 dark:text-warning-400',
    titleColor: 'text-warning-700 dark:text-warning-300',
    detailsBox: 'bg-warning-50 dark:bg-warning-900/20 border-warning-200 dark:border-warning-800',
    borderBottom: 'border-warning-100 dark:border-warning-900/50',
  },
  archive: {
    border: 'border-2 border-surface-200 dark:border-surface-700',
    iconBg: 'bg-surface-100 dark:bg-surface-800',
    iconColor: 'text-surface-600 dark:text-surface-400',
    titleColor: 'text-surface-800 dark:text-surface-200',
    detailsBox: 'bg-surface-50 dark:bg-surface-800/50 border-surface-200 dark:border-surface-700',
    borderBottom: 'border-surface-200 dark:border-surface-700',
  },
};

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    </svg>
  );
}

function DangerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
      />
    </svg>
  );
}

export function ConfirmActionModal({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  loading = false,
  details,
  error,
}: ConfirmActionModalProps) {
  if (!open) return null;

  const styles = VARIANT_STYLES[variant];
  const Icon =
    variant === 'danger' ? DangerIcon : variant === 'archive' ? ArchiveIcon : WarningIcon;

  const handleConfirm = () => {
    onConfirm();
  };

  const borderBottomClass =
    variant === 'danger'
      ? 'border-danger-100 dark:border-danger-900/50'
      : variant === 'warning'
        ? 'border-warning-100 dark:border-warning-900/50'
        : styles.borderBottom;

  const buttonVariant =
    variant === 'danger' ? 'danger' : variant === 'warning' ? 'warning' : 'secondary';
  const buttonClass =
    variant === 'danger'
      ? 'bg-danger-600 hover:bg-danger-700 text-white border-danger-600 hover:border-danger-700'
      : variant === 'archive'
        ? 'bg-surface-700 hover:bg-surface-800 text-white dark:bg-surface-600 dark:hover:bg-surface-700 border-surface-700 hover:border-surface-800'
        : undefined;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      aria-modal="true"
      role="alertdialog"
      aria-labelledby="confirm-action-modal-title"
      aria-describedby="confirm-action-modal-desc"
    >
      <div
        className={`card w-full max-w-lg space-y-5 shadow-xl bg-white dark:bg-surface-900 ${styles.border}`}
      >
        <div className={`flex items-center gap-3 pb-2 border-b ${borderBottomClass}`}>
          <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${styles.iconBg}`}>
            <Icon className={`w-5 h-5 ${styles.iconColor}`} />
          </div>
          <h3 id="confirm-action-modal-title" className={`text-lg font-semibold ${styles.titleColor}`}>
            {title}
          </h3>
        </div>
        <p id="confirm-action-modal-desc" className="text-sm text-surface-700 dark:text-surface-200">
          {description}
        </p>
        {details && (
          <div className={`rounded-lg border p-4 space-y-2 ${styles.detailsBox}`}>{details}</div>
        )}
        {error && (
          <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-3 py-2">
            <p className="text-sm text-danger-700 dark:text-danger-500">{error}</p>
          </div>
        )}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={buttonVariant}
            onClick={handleConfirm}
            loading={loading}
            className={buttonClass}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
