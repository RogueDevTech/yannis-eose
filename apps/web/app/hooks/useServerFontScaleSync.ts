import { useEffect } from 'react';
import { fetchClientConfig } from '~/lib/trpc-browser';
import { isFontScaleId, persistAndApplyFontScale, readStoredFontScale } from '~/lib/font-scale';

/**
 * When `enabled`, fetch the user's effective font scale and align localStorage + DOM once.
 * Used for logged-in shells so server preference wins over a stale client default.
 */
export function useServerFontScaleSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let cancelled = false;
    void (async () => {
      const cfg = await fetchClientConfig();
      if (cancelled || !cfg) return;
      const eff = cfg.effectiveFontScale;
      if (!isFontScaleId(eff)) return;
      if (readStoredFontScale() !== eff) {
        persistAndApplyFontScale(eff);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
