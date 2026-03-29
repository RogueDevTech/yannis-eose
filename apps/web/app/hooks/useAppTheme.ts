import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  type AppThemeId,
  APP_THEMES,
  applyAppTheme,
  persistAndApplyTheme,
  readStoredThemeId,
  THEME_CHANGE_EVENT,
} from '~/lib/theme';
import { postUpdateMyAppTheme } from '~/lib/trpc-browser';

function subscribePrefersDark(cb: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function getPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useAppTheme() {
  const [themeId, setThemeIdState] = useState<AppThemeId>(() =>
    typeof window !== 'undefined' ? readStoredThemeId() : 'system',
  );

  const prefersDark = useSyncExternalStore(subscribePrefersDark, getPrefersDark, () => false);

  useEffect(() => {
    const id = readStoredThemeId();
    setThemeIdState(id);
    applyAppTheme(id);
  }, []);

  useEffect(() => {
    if (themeId !== 'system') return;
    applyAppTheme('system');
  }, [themeId, prefersDark]);

  useEffect(() => {
    const onThemeChange = (e: Event) => {
      const detail = (e as CustomEvent<{ id: AppThemeId }>).detail;
      if (detail?.id) setThemeIdState(detail.id);
    };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  }, []);

  const setTheme = useCallback((id: AppThemeId) => {
    persistAndApplyTheme(id);
    setThemeIdState(id);
    void postUpdateMyAppTheme(id);
  }, []);

  const activeTheme = useMemo(
    () =>
      APP_THEMES.find((t) => t.id === themeId) ??
      APP_THEMES.find((t) => t.id === 'system') ??
      APP_THEMES[0],
    [themeId],
  );

  const isDarkTheme = themeId === 'system' ? prefersDark : activeTheme.usesDarkClass;

  return {
    themeId,
    setTheme,
    activeTheme,
    isDarkTheme,
  };
}
