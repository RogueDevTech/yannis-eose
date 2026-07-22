import { Modal } from '~/components/ui/modal';

export function FunnelInfoIcon({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className="ml-1 inline-flex items-center justify-center rounded-full text-app-fg-muted hover:text-app-fg transition-colors"
      aria-label="View breakdown"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
      </svg>
    </button>
  );
}

export function FunnelBreakdownModal({
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
  lines: Array<{ label: string; value: number; bold?: boolean; muted?: boolean }>;
}) {
  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-sm" contentClassName="p-5">
      <h2 className="text-base font-semibold text-app-fg mb-1">{title}</h2>
      <p className="text-sm text-app-fg-muted mb-4">{description}</p>
      <div className="space-y-0.5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`flex items-center justify-between gap-4 py-1.5 ${l.bold ? 'font-semibold border-t border-app-border pt-2.5 mt-1' : ''}`}
          >
            <span className={`text-sm ${l.muted ? 'text-app-fg-muted' : 'text-app-fg'}`}>{l.label}</span>
            <span className="text-sm tabular-nums text-app-fg">{l.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
