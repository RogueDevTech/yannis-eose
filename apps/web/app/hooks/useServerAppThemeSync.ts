import { useEffect } from 'react';
import { fetchClientConfig } from '~/lib/trpc-browser';
import { isAppThemeId, persistAndApplyTheme, readStoredThemeId } from '~/lib/theme';

/**
 * When `enabled`, fetch org + user effective theme and align localStorage + DOM once.
 * Used for logged-in shells so server preference wins over a stale client default.
 */
export function useServerAppThemeSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let cancelled = false;
    void (async () => {
      const cfg = await fetchClientConfig();
      if (cancelled || !cfg) return;
      const eff = cfg.effectiveAppTheme;
      if (!isAppThemeId(eff)) return;
      if (readStoredThemeId() !== eff) {
        persistAndApplyTheme(eff);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
