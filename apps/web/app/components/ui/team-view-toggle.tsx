export type TeamViewMode = 'table' | 'grid';

export interface TeamViewToggleProps {
  value: TeamViewMode;
  onChange: (v: TeamViewMode) => void;
  className?: string;
}

export function TeamViewToggle({ value, onChange, className = '' }: TeamViewToggleProps) {
  return (
    <div
      className={`flex items-center gap-1 rounded-md border border-app-border bg-app-hover p-1 shrink-0 ${className}`}
      role="group"
      aria-label="Team layout"
    >
      <button
        type="button"
        onClick={() => onChange('table')}
        className={`text-xs font-medium px-2.5 py-1 rounded transition-colors ${
          value === 'table' ? 'bg-white dark:bg-transparent text-app-fg shadow-sm border border-app-border' : 'text-app-fg-muted hover:text-app-fg'
        }`}
      >
        Table
      </button>
      <button
        type="button"
        onClick={() => onChange('grid')}
        className={`text-xs font-medium px-2.5 py-1 rounded transition-colors ${
          value === 'grid' ? 'bg-white dark:bg-transparent text-app-fg shadow-sm border border-app-border' : 'text-app-fg-muted hover:text-app-fg'
        }`}
      >
        Grid
      </button>
    </div>
  );
}
