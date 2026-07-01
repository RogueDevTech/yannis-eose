import { Modal } from '~/components/ui/modal';
import { formatNaira } from '~/lib/format-amount';

export function RemittanceInfoIcon({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className="ml-1 inline-flex items-center justify-center rounded-full text-app-fg-muted hover:text-app-fg transition-colors"
      aria-label="View calculation breakdown"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
      </svg>
    </button>
  );
}

export type FormulaLine = { label: string; amount: number; type: 'value' | 'deduction' | 'result'; count?: number };

export function FormulaBreakdownModal({
  open,
  onClose,
  title,
  description,
  lines,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  lines: FormulaLine[];
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-app-fg">{title}</h2>
          <p className="text-sm text-app-fg-muted mt-1">{description}</p>
        </div>
        <div className="space-y-1.5">
          {lines.map((line, i) => {
            const isResult = line.type === 'result';
            const isDeduction = line.type === 'deduction';
            return (
              <div
                key={i}
                className={`flex items-center justify-between gap-3 text-sm px-2 py-1.5 rounded ${
                  isResult ? 'bg-app-hover/80 border border-app-border font-semibold' : ''
                }`}
              >
                <span className={`${isResult ? 'text-app-fg font-semibold' : 'text-app-fg-muted'}`}>
                  {isDeduction ? '− ' : isResult ? '= ' : ''}{line.label}
                  {line.count != null && <span className="ml-1 text-app-fg-muted/60">({line.count})</span>}
                </span>
                <span className={`tabular-nums font-medium ${
                  isResult
                    ? line.amount >= 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'
                    : isDeduction
                      ? 'text-red-500'
                      : 'text-app-fg'
                }`}>
                  {formatNaira(Math.round(Math.abs(line.amount)))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
