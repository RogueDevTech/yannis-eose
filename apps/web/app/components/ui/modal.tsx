import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MAX_WIDTH_CLASSES: Record<string, string> = {
  'max-w-sm': 'md:max-w-sm',
  'max-w-md': 'md:max-w-md',
  'max-w-lg': 'md:max-w-lg',
  'max-w-xl': 'md:max-w-xl',
  'max-w-2xl': 'md:max-w-2xl',
  'max-w-4xl': 'md:max-w-4xl',
  /** Full width of the viewport padding area (see outer `md:p-4` wrapper). */
  'max-w-full': 'md:max-w-none',
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
 * Responsive modal: on mobile/tablet (< md), slides up from bottom (full width, rounded top);
 * on md+ (desktop) centered with max width and fade-in. Slide-up is mobile-only.
 *
 * Portaled to document.body with z-[90] so the overlay covers fixed header/shell (z-50 and below).
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
  const [mounted, setMounted] = useState(false);
  // ALL hooks must be declared before any conditional `return`. Previously this `useRef`
  // sat below the `!open` early return, which violates the Rules of Hooks: on the first render
  // (open=false) only 3 hooks ran; on the re-render where open flipped to true, React saw a
  // 4th hook and crashed with "Rendered more hooks than during the previous render". That
  // crash bubbled up to the page-level ErrorBoundary, so every modal trigger looked broken.
  const downOnBackdropRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  /** Avoid SSR/hydration mismatch — portals only run in the browser. */
  if (!mounted || typeof document === 'undefined') return null;

  const maxWidthClass = MAX_WIDTH_CLASSES[maxWidth] ?? 'md:max-w-lg';

  // Only close when the press STARTS and ENDS on the backdrop itself.
  // This survives:
  // - drag-select that begins inside the modal and releases over the backdrop
  // - phantom click events fired after native pickers (date / select) dismiss on iOS
  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    downOnBackdropRef.current = e.target === e.currentTarget;
  };
  const handleBackdropMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    const wasDown = downOnBackdropRef.current;
    downOnBackdropRef.current = false;
    if (wasDown && e.target === e.currentTarget) onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] min-h-dvh w-full">
      <div
        className={`absolute inset-0 min-h-dvh w-full ${backdropBlur ? 'backdrop-blur-sm ' : ''}bg-black/50`}
        aria-hidden
      />
      <div
        className="relative z-[1] flex min-h-dvh w-full items-end md:items-center justify-center p-0 md:p-4"
        onMouseDown={handleBackdropMouseDown}
        onMouseUp={handleBackdropMouseUp}
        aria-modal="true"
        role={role}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
      >
        <div
          className={[
            'w-full max-h-[90dvh] overflow-y-auto table-sticky-panel',
            'rounded-t-2xl md:rounded-xl',
            'bg-app-elevated shadow-xl',
            'pb-[max(2.5rem,env(safe-area-inset-bottom))] md:pb-5',
            'max-md:animate-slide-up-from-bottom md:animate-fade-in',
            maxWidthClass,
            contentClassName,
          ].join(' ')}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
