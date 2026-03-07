import { useEffect } from 'react';

const MAX_WIDTH_CLASSES: Record<string, string> = {
  'max-w-sm': 'sm:max-w-sm',
  'max-w-md': 'sm:max-w-md',
  'max-w-lg': 'sm:max-w-lg',
  'max-w-xl': 'sm:max-w-xl',
  'max-w-2xl': 'sm:max-w-2xl',
  'max-w-4xl': 'sm:max-w-4xl',
};

export type ModalMaxWidth = keyof typeof MAX_WIDTH_CLASSES;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Extra classes for the content pane */
  contentClassName?: string;
  /** Max width on desktop. Default: max-w-lg */
  maxWidth?: ModalMaxWidth;
  /** Accessibility */
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  role?: 'dialog' | 'alertdialog';
  /** Use backdrop blur. Default: false */
  backdropBlur?: boolean;
}

/**
 * Responsive modal: on mobile only, slides up from bottom (full width, rounded top);
 * on sm+ (desktop) centered with max width and fade-in (no slide-up). Slide-up is mobile-only.
 */
export function Modal({
  open,
  onClose,
  children,
  contentClassName = '',
  maxWidth = 'max-w-lg',
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  role = 'dialog',
  backdropBlur = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const maxWidthClass = MAX_WIDTH_CLASSES[maxWidth] ?? 'sm:max-w-lg';

  return (
    <>
      <div
        className={`fixed inset-0 z-50 ${backdropBlur ? 'backdrop-blur-sm ' : ''}bg-black/50`}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={onClose}
        aria-modal="true"
        role={role}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
      >
        <div
          className={[
            'w-full max-h-[90dvh] overflow-y-auto',
            'rounded-t-2xl sm:rounded-xl',
            'bg-white dark:bg-surface-900 shadow-xl',
            'pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:pb-5',
            'animate-slide-up-from-bottom sm:animate-fade-in',
            maxWidthClass,
            contentClassName,
          ].join(' ')}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </>
  );
}
