import { useState, useCallback, type ReactNode } from 'react';
import { FilterPrefsContext, type AllFilterPrefs } from '~/hooks/useFilterPreferences';

interface FilterPreferencesProviderProps {
  /** All saved prefs from the root loader (pageKey → filters map). */
  initialPrefs: AllFilterPrefs;
  children: ReactNode;
}

/**
 * Provides all filter preferences to the component tree via context.
 * Mount once in root.tsx so every page reads from memory rather than
 * fetching `/api/filter-preferences` individually on mount.
 */
export function FilterPreferencesProvider({ initialPrefs, children }: FilterPreferencesProviderProps) {
  const [prefs, setPrefs] = useState<AllFilterPrefs>(initialPrefs);

  const setPagePrefs = useCallback((pageKey: string, filters: Record<string, string> | null) => {
    setPrefs((prev) => {
      if (filters == null) {
        const next = { ...prev };
        delete next[pageKey];
        return next;
      }
      return { ...prev, [pageKey]: filters };
    });
  }, []);

  return (
    <FilterPrefsContext.Provider value={{ prefs, setPagePrefs }}>
      {children}
    </FilterPrefsContext.Provider>
  );
}
