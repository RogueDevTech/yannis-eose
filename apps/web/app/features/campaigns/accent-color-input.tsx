import { TextInput } from '~/components/ui/text-input';

interface AccentColorInputProps {
  value: string;
  onChange: (next: string) => void;
  hint?: string;
}

function normalizeHexColor(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^#?[0-9a-fA-F]{0,6}$/.test(trimmed)) return null;
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (withHash.length === 7) return withHash.toUpperCase();
  return withHash;
}

export function AccentColorInput({
  value,
  onChange,
  hint = 'Preview updates as you edit.',
}: AccentColorInputProps) {
  return (
    <div className="sm:col-span-1 space-y-1">
      <label className="text-xs font-medium text-app-fg-muted">Accent color</label>
      <div className="flex items-center gap-3">
        <label className="relative inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-app-border bg-app-canvas shadow-sm">
          <input
            type="color"
            aria-label="Accent color"
            value={value}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
          <span
            className="h-6 w-6 rounded-md border border-white/60 shadow-sm"
            style={{ backgroundColor: value }}
            aria-hidden
          />
        </label>

        <TextInput
          label=""
          aria-label="Accent hex value"
          value={value}
          onChange={(e) => {
            const next = normalizeHexColor(e.target.value);
            if (next !== null) onChange(next);
          }}
          placeholder="#F97316"
          className="font-mono uppercase"
          wrapperClassName="flex-1"
        />
      </div>
      <p className="text-xs text-app-fg-muted">{hint}</p>
    </div>
  );
}
