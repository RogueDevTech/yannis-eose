import { useIsMobile } from '~/hooks/useIsMobile';
import { Modal } from '~/components/ui/modal';

export interface ResponsiveFormPanelProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * When open: on mobile renders as a slide-up modal; on desktop renders children inline (no overlay).
 * When closed, renders nothing.
 */
export function ResponsiveFormPanel({ open, onClose, children, className = '' }: ResponsiveFormPanelProps) {
  const isMobile = useIsMobile();

  if (!open) return null;

  if (isMobile) {
    return (
      <Modal open onClose={onClose} maxWidth="max-w-lg" contentClassName={`p-4 ${className}`}>
        {children}
      </Modal>
    );
  }

  return <>{children}</>;
}
