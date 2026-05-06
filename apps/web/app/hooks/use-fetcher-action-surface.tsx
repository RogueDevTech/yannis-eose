import { useEffect, useRef } from 'react';
import { InlineNotification } from '~/components/ui/inline-notification';
import { humanizeZodIssuesString } from '~/lib/api-error';

/** Minimal Remix fetcher shape — works with `useFetcher()`. */
export type FetcherForActionSurface = {
  state: 'idle' | 'submitting' | 'loading';
  formData: FormData | undefined;
  data: unknown;
};

/**
 * Tracks the last submitted `intent` and formats `fetcher.data.error` for inline modal UI.
 *
 * Pair with `useFetcherToast(..., { skipErrorToast: overlayOpenForThisFetcher })` — one surface
 * per fetcher when a page uses multiple fetchers (`OrderDetailPage`, `CSDashboardPage`).
 *
 * Intent is stamped while `state` is `submitting` | `loading` from `fetcher.formData`, because
 * Remix clears `formData` once the action settles (see `useCloseOnFetcherSuccess`).
 */
export function useFetcherActionSurface(fetcher: FetcherForActionSurface) {
  const lastSubmittedIntentRef = useRef<string | null>(null);
  useEffect(() => {
    if (fetcher.state === 'submitting' || fetcher.state === 'loading') {
      const intent = fetcher.formData?.get('intent');
      if (typeof intent === 'string' && intent) lastSubmittedIntentRef.current = intent;
    }
  }, [fetcher.state, fetcher.formData]);

  const rawError = (fetcher.data as { error?: string })?.error;
  const friendlyError = rawError ? humanizeZodIssuesString(rawError) : '';
  const resolverIntent = lastSubmittedIntentRef.current;

  const errorMatchingIntent = (intent: string | readonly string[]): string | null => {
    if (!friendlyError || !resolverIntent) return null;
    const list = typeof intent === 'string' ? [intent] : intent;
    return list.includes(resolverIntent) ? friendlyError : null;
  };

  return {
    resolverIntent,
    friendlyError,
    rawError,
    errorMatchingIntent,
  };
}

export function ModalFetcherInlineError({
  message,
  className = '',
}: {
  message: string | null | undefined;
  className?: string;
}) {
  if (!message) return null;
  return <InlineNotification variant="danger" message={message} className={className} />;
}
