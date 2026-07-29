import { TruncatedTextWithPopup } from '~/components/ui/truncated-text-popup';

/**
 * Email cell helper: first 20 characters + info popup with full address and copy.
 */
export function CopyableEmail({
  email,
  chars = 20,
  className = '',
}: {
  email: string | null | undefined;
  chars?: number;
  className?: string;
}) {
  return (
    <TruncatedTextWithPopup
      value={email}
      chars={chars}
      label="Email"
      className={className}
      textClassName={className.includes('text-xs') ? 'text-xs text-app-fg-muted' : 'text-app-fg-muted'}
      copyable
    />
  );
}
