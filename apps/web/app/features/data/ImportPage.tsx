import { useState } from 'react';
import { PageHeader } from '~/components/ui/page-header';
import { OrdersImportPage, type OrdersImportPageProps } from '~/features/orders/OrdersImportPage';

/* ── Import type card metadata ──────────────────────────────── */

type ImportTypeKey = 'orders';

interface ImportTypeDef {
  key: ImportTypeKey;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const IMPORT_TYPES: ImportTypeDef[] = [
  {
    key: 'orders',
    label: 'Orders',
    description: 'Import funnel or offline orders from a CRM export spreadsheet.',
    icon: <OrdersIcon />,
  },
];

/* ── Icons ───────────────────────────────────────────────────── */

function OrdersIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
    </svg>
  );
}

/* ── Main component ──────────────────────────────────────────── */

export interface ImportPageProps extends OrdersImportPageProps {}

export function ImportPage(props: ImportPageProps) {
  const [selectedKey, setSelectedKey] = useState<ImportTypeKey | null>(null);

  return (
    <div>
      <PageHeader
        title="Import"
        description="Upload data across all domains."
      />

      {/* Card grid */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {IMPORT_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSelectedKey(selectedKey === t.key ? null : t.key)}
            className={`text-left rounded-xl border p-4 transition-all duration-150 ${
              selectedKey === t.key
                ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/30'
                : 'border-app-border bg-app-elevated hover:border-brand-300 hover:bg-app-hover'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                  selectedKey === t.key
                    ? 'bg-brand-500/20 text-brand-600 dark:text-brand-400'
                    : 'bg-app-hover text-app-fg-muted'
                }`}
              >
                {t.icon}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-app-fg">{t.label}</p>
                <p className="text-xs text-app-fg-muted mt-0.5 line-clamp-2">{t.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Expanded import content */}
      {selectedKey === 'orders' && (
        <div className="mt-6">
          <OrdersImportPage {...props} />
        </div>
      )}
    </div>
  );
}
