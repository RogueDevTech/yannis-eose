/**
 * Per-user font scaling. Sets the root html `font-size` so every Tailwind rem
 * value (text + spacing) scales proportionally. Mirror of `~/lib/theme.ts`.
 */

export const FONT_SCALES = [
  { id: 'base', label: 'Default', sample: 'Aa', rootPx: 14 },
  { id: 'large', label: 'Large', sample: 'Aa', rootPx: 15.75 },
  { id: 'xlarge', label: 'Extra large', sample: 'Aa', rootPx: 17.5 },
] as const;

export type FontScaleId = (typeof FONT_SCALES)[number]['id'];

const FONT_SCALE_IDS = FONT_SCALES.map((s) => s.id) as FontScaleId[];

export const FONT_SCALE_STORAGE_KEY = 'yannis_font_scale';
export const FONT_SCALE_CHANGE_EVENT = 'yannis-font-scale-change';

export function isFontScaleId(value: string): value is FontScaleId {
  return (FONT_SCALE_IDS as readonly string[]).includes(value);
}

export function parseStoredFontScale(raw: string | null): FontScaleId {
  if (raw && isFontScaleId(raw)) return raw;
  return 'base';
}

export function getFontScaleMeta(id: FontScaleId): (typeof FONT_SCALES)[number] {
  return FONT_SCALES.find((s) => s.id === id) ?? FONT_SCALES[0];
}

export function readStoredFontScale(): FontScaleId {
  if (typeof window === 'undefined') return 'base';
  try {
    return parseStoredFontScale(localStorage.getItem(FONT_SCALE_STORAGE_KEY));
  } catch {
    return 'base';
  }
}

export function applyFontScale(id: FontScaleId): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  const meta = getFontScaleMeta(id);
  el.dataset.fontScale = id;
  el.style.fontSize = `${meta.rootPx}px`;
}

export function persistAndApplyFontScale(id: FontScaleId): void {
  try {
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, id);
  } catch {
    /* ignore quota / private mode */
  }
  applyFontScale(id);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FONT_SCALE_CHANGE_EVENT, { detail: { id } }));
  }
}

/** Inline boot script — runs before paint to set root font-size and avoid resize flash. */
export function getFontScaleBootScript(): string {
  const map: Record<string, number> = {};
  for (const s of FONT_SCALES) map[s.id] = s.rootPx;
  return `(function(){try{var k=${JSON.stringify(FONT_SCALE_STORAGE_KEY)};var v=localStorage.getItem(k);var m=${JSON.stringify(map)};var id=(v&&m[v])?v:'base';document.documentElement.setAttribute('data-font-scale',id);document.documentElement.style.fontSize=m[id]+'px';}catch(e){}})();`;
}
