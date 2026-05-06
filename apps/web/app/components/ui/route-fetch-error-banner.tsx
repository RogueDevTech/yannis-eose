import { useRevalidator } from '@remix-run/react';
import { InlineNotification } from '~/components/ui/inline-notification';

type Variant = 'danger' | 'warning';

interface RouteFetchErrorBannerProps {
  /** Non-empty strings surface as one combined alert (multi-line list when length > 1). */
  messages: string[];
  variant?: Variant;
  reloadLabel?: string;
  reloadingLabel?: string;
}

/**
 * Surfaced when loader API calls fail instead of silent empty data — Reload triggers Remix revalidation.
 */
export function RouteFetchErrorBanner({
  messages,
  variant = 'danger',
  reloadLabel = 'Reload data',
  reloadingLabel = 'Reloading…',
}: RouteFetchErrorBannerProps) {
  const { revalidate, state } = useRevalidator();
  const busy = state === 'loading';
  const filtered = messages.filter((m) => m.trim().length > 0);
  if (filtered.length === 0) return null;

  const body =
    filtered.length === 1
      ? (filtered[0] ?? '')
      : ['Some data failed to load:', ...filtered.map((m) => `• ${m}`)].join('\n');

  return (
    <InlineNotification
      variant={variant}
      message={body}
      actions={[
        {
          label: busy ? reloadingLabel : reloadLabel,
          disabled: busy,
          onClick: () => {
            if (!busy) revalidate();
          },
        },
      ]}
    />
  );
}
