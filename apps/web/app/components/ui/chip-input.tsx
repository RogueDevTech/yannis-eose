import { useCallback, useMemo, useState } from 'react';

function normalizeChip(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export interface ChipInputProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  /** When true, duplicates are prevented (case-insensitive). Default: true. */
  dedupe?: boolean;
}

export function ChipInput({
  label,
  value,
  onChange,
  placeholder = 'Type and press Enter…',
  hint,
  disabled = false,
  dedupe = true,
}: ChipInputProps) {
  const [draft, setDraft] = useState('');

  const normalizedValue = useMemo(() => value.map((v) => normalizeChip(v)).filter(Boolean), [value]);

  const removeAt = useCallback(
    (idx: number) => {
      onChange(normalizedValue.filter((_, i) => i !== idx));
    },
    [normalizedValue, onChange],
  );

  const commitDraft = useCallback(() => {
    const next = normalizeChip(draft);
    if (!next) return;
    const exists = dedupe
      ? normalizedValue.some((v) => v.toLowerCase() === next.toLowerCase())
      : normalizedValue.includes(next);
    if (exists) {
      setDraft('');
      return;
    }
    onChange([...normalizedValue, next]);
    setDraft('');
  }, [draft, dedupe, normalizedValue, onChange]);

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-app-fg-muted">{label}</label>
      <div
        className={[
          'rounded-lg border border-app-border bg-app-canvas px-2.5 py-2 transition-colors',
          disabled ? 'opacity-60 cursor-not-allowed' : 'focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500',
        ].join(' ')}
      >
        <div className="flex flex-wrap gap-1.5">
          {normalizedValue.map((chip, idx) => (
            <span
              key={`${chip}-${idx}`}
              className="inline-flex items-center gap-1 rounded-full border border-app-border bg-app-hover px-2 py-1 text-xs text-app-fg"
              title={chip}
            >
              <span className="max-w-[16rem] truncate">{chip}</span>
              {!disabled ? (
                <button
                  type="button"
                  className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-app-fg-muted hover:text-app-fg hover:bg-app-elevated"
                  aria-label={`Remove ${chip}`}
                  onClick={() => removeAt(idx)}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              ) : null}
            </span>
          ))}
          <input
            type="text"
            value={draft}
            disabled={disabled}
            placeholder={normalizedValue.length === 0 ? placeholder : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commitDraft();
              } else if (e.key === 'Backspace' && draft.length === 0 && normalizedValue.length > 0) {
                e.preventDefault();
                removeAt(normalizedValue.length - 1);
              }
            }}
            onBlur={() => commitDraft()}
            className="min-w-[10rem] flex-1 bg-transparent text-sm text-app-fg placeholder:text-app-fg-muted outline-none"
          />
        </div>
      </div>
      {hint ? <p className="text-mini text-app-fg-muted">{hint}</p> : null}
    </div>
  );
}

