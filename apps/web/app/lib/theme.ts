/**
 * RGB triplets (space-separated) — must stay in sync with `apps/web/app/tailwind.css`
 * `[data-app-theme='…']` blocks. Used for Settings appearance previews.
 */
export const THEME_PREVIEW_RGB = {
  light: {
    canvas: '248 250 252',
    elevated: '255 255 255',
    logoStrip: '255 255 255',
    border: '226 232 240',
    fg: '15 23 42',
  },
  dark: {
    canvas: '2 6 23',
    elevated: '15 23 42',
    logoStrip: '15 23 42',
    border: '51 65 85',
    fg: '241 245 249',
  },
  soft: {
    canvas: '241 237 229',
    elevated: '246 243 236',
    logoStrip: '246 243 236',
    border: '232 228 219',
    fg: '54 50 45',
  },
  dim: {
    canvas: '34 39 46',
    elevated: '45 51 59',
    logoStrip: '45 51 59',
    border: '68 76 86',
    fg: '205 217 229',
  },
  ink: {
    canvas: '8 8 10',
    elevated: '20 20 23',
    logoStrip: '20 20 23',
    border: '48 48 54',
    fg: '245 245 245',
  },
} as const;

/** Primary action color (Tailwind `brand-500`) — same for all themes */
export const THEME_PREVIEW_BRAND_HEX = '#1565C0';

/** `rgb(R, G, B)` from a space-separated triplet */
export function previewRgb(spaceSeparated: string): string {
  return `rgb(${spaceSeparated.trim().split(/\s+/).join(', ')})`;
}

/** Resolves from OS when the user picks System */
export const SYSTEM_LIGHT_THEME = 'light' as const;
export const SYSTEM_DARK_THEME = 'ink' as const;

/** Named app themes — add entries here + CSS in tailwind.css `[data-app-theme='…']` */
export const APP_THEMES = [
  {
    id: 'system',
    label: 'System',
    usesDarkClass: false,
    preview: THEME_PREVIEW_RGB.light,
  },
  { id: 'light', label: 'Light', usesDarkClass: false, preview: THEME_PREVIEW_RGB.light },
  { id: 'dark', label: 'Dark', usesDarkClass: true, preview: THEME_PREVIEW_RGB.dark },
  { id: 'dim', label: 'Dim', usesDarkClass: true, preview: THEME_PREVIEW_RGB.dim },
  { id: 'ink', label: 'Ink', usesDarkClass: true, preview: THEME_PREVIEW_RGB.ink },
  { id: 'soft', label: 'Calm', usesDarkClass: false, preview: THEME_PREVIEW_RGB.soft },
] as const;

export type AppThemeId = (typeof APP_THEMES)[number]['id'];

/** Theme id actually set on `data-app-theme` (System is never written to the DOM). */
export type ConcreteThemeId = Exclude<AppThemeId, 'system'>;

export function resolveAppliedThemeId(id: AppThemeId): ConcreteThemeId {
  if (id === 'system') {
    if (typeof window === 'undefined') return SYSTEM_LIGHT_THEME;
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? SYSTEM_DARK_THEME
      : SYSTEM_LIGHT_THEME;
  }
  return id;
}

export const THEME_STORAGE_KEY = 'yannis_theme';

export const THEME_CHANGE_EVENT = 'yannis-theme-change';

const THEME_IDS = APP_THEMES.map((t) => t.id) as AppThemeId[];

export function isAppThemeId(value: string): value is AppThemeId {
  return (THEME_IDS as readonly string[]).includes(value);
}

export function parseStoredThemeId(raw: string | null): AppThemeId {
  // legacy theme id removed — map to Dim (blue-gray dark)
  if (raw === 'neutral') return 'dim';
  if (raw === 'contrast') return 'light';
  if (raw && isAppThemeId(raw)) return raw;
  return 'system';
}

export function getThemeMeta(id: AppThemeId): (typeof APP_THEMES)[number] {
  const found = APP_THEMES.find((t) => t.id === id);
  return found ?? APP_THEMES.find((t) => t.id === 'system') ?? APP_THEMES[0];
}

export function readStoredThemeId(): AppThemeId {
  if (typeof window === 'undefined') return 'system';
  try {
    return parseStoredThemeId(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function applyAppTheme(id: AppThemeId): void {
  if (typeof document === 'undefined') return;
  const applied = resolveAppliedThemeId(id);
  const el = document.documentElement;
  el.dataset.appTheme = applied;
  if (getThemeMeta(applied).usesDarkClass) {
    el.classList.add('dark');
  } else {
    el.classList.remove('dark');
  }
}

export function persistAndApplyTheme(id: AppThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* ignore quota / private mode */
  }
  applyAppTheme(id);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { id } }));
  }
}

/** Inline boot script — keep in sync with APP_THEMES + `resolveAppliedThemeId` (runs before paint). */
export function getThemeBootScript(): string {
  const ids = APP_THEMES.map((t) => t.id);
  const darkFlags: Record<string, true> = {};
  for (const t of APP_THEMES) {
    if (t.usesDarkClass) darkFlags[t.id] = true;
  }
  const idsJson = JSON.stringify(ids);
  const darkJson = JSON.stringify(darkFlags);
  const light = JSON.stringify(SYSTEM_LIGHT_THEME);
  const darkResolved = JSON.stringify(SYSTEM_DARK_THEME);
  return `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var v=localStorage.getItem(k);if(v==='neutral')v='dim';if(v==='contrast')v='light';var ids=${idsJson};var useSys=v==null||v==='system'||ids.indexOf(v)<0;var id;if(useSys){id=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?${darkResolved}:${light};}else{id=v;}document.documentElement.setAttribute('data-app-theme',id);var d=${darkJson};if(d[id])document.documentElement.classList.add('dark');else document.documentElement.classList.remove('dark');}catch(e){}})();`;
}
