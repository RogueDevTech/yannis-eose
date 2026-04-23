import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type FontScaleId,
  FONT_SCALES,
  applyFontScale,
  persistAndApplyFontScale,
  readStoredFontScale,
  FONT_SCALE_CHANGE_EVENT,
} from '~/lib/font-scale';
import { postUpdateMyFontScale } from '~/lib/trpc-browser';

export function useFontScale() {
  const [fontScaleId, setFontScaleIdState] = useState<FontScaleId>(() =>
    typeof window !== 'undefined' ? readStoredFontScale() : 'base',
  );

  useEffect(() => {
    const id = readStoredFontScale();
    setFontScaleIdState(id);
    applyFontScale(id);
  }, []);

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ id: FontScaleId }>).detail;
      if (detail?.id) setFontScaleIdState(detail.id);
    };
    window.addEventListener(FONT_SCALE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(FONT_SCALE_CHANGE_EVENT, onChange);
  }, []);

  const setFontScale = useCallback((id: FontScaleId) => {
    persistAndApplyFontScale(id);
    setFontScaleIdState(id);
    void postUpdateMyFontScale(id);
  }, []);

  const activeScale = useMemo(
    () => FONT_SCALES.find((s) => s.id === fontScaleId) ?? FONT_SCALES[0],
    [fontScaleId],
  );

  return { fontScaleId, setFontScale, activeScale };
}
