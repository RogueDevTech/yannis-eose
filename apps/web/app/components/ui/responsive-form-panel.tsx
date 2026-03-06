import { useEffect } from 'react';
import { useIsMobile } from '~/hooks/useIsMobile';

export interface ResponsiveFormPanelProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * When open: on mobile renders as a modal (overlay + scrollable panel);
 * on desktop renders children inline (no overlay). When closed, renders nothing.
 */
export function ResponsiveFormPanel({ open, onClose, children, className = '' }: ResponsiveFormPanelProps) {
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!open || !isMobile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, isMobile, onClose]);

  if (!open) return null;

  if (isMobile) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        aria-modal="true"
        role="dialog"
      >
        <div
          className="fixed inset-0 bg-black/50"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          className={`relative bg-white dark:bg-surface-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-4 ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
