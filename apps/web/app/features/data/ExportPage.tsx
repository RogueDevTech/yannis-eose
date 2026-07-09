import { useState, useMemo } from 'react';
import { PageHeader } from '~/components/ui/page-header';
import { ExportModal, type ExportModalPicklists } from '~/components/ui/export-modal';
import { EXPORT_CONFIGS, type ExportConfig } from '~/lib/export-config';
import type { ExportReportKey } from '@yannis/shared/validators';
import { canonicalPermissionCode } from '~/lib/permission-codes';

/* ── Report type card metadata ───────────────────────────────── */

interface ReportTypeDef {
  key: ExportReportKey;
  label: string;
  description: string;
  /** Domain icon SVG for visual grouping. */
  icon: React.ReactNode;
  /** Permission(s) the user needs to see + use this report type. */
  requiredPermissions: string[];
  /** Which picklist keys this report type needs (lazy-loaded). */
  picklists: (keyof ExportModalPicklists)[];
}

const REPORT_TYPES: ReportTypeDef[] = [
  {
    key: 'cs_orders',
    label: 'Sales Orders',
    description: 'Funnel + offline orders with customer, closer, status, and amount columns.',
    icon: <OrdersIcon />,
    requiredPermissions: ['orders.read', 'orders.export'],
    picklists: ['csClosers'],
  },
  {
    key: 'cs_team',
    label: 'Sales Team Analysis',
    description: 'Closer leaderboard with confirmation rates, delivery rates, and idle metrics.',
    icon: <TeamIcon />,
    requiredPermissions: ['cs.teamOverview', 'orders.export'],
    picklists: [],
  },
  {
    key: 'marketing_orders',
    label: 'Marketing Orders',
    description: 'Orders scoped by media buyer, campaign, and branch.',
    icon: <MarketingIcon />,
    requiredPermissions: ['marketing.orders', 'orders.export'],
    picklists: ['mediaBuyers', 'products', 'campaigns'],
  },
  {
    key: 'marketing_team',
    label: 'Marketing Team Analysis',
    description: 'Media buyer performance: spend, ROAS, CPA, and delivery rates.',
    icon: <TeamIcon />,
    requiredPermissions: ['marketing.teamOverview', 'marketing.export'],
    picklists: [],
  },
  {
    key: 'cross_funnel',
    label: 'Cross-Funnel Duplicates',
    description: 'Duplicate lead attempts across funnels and media buyers.',
    icon: <MarketingIcon />,
    requiredPermissions: ['marketing.read', 'marketing.export'],
    picklists: ['mediaBuyers', 'products', 'campaigns'],
  },
  {
    key: 'disbursements',
    label: 'Disbursements',
    description: 'Fund disbursements to media buyers with amounts, status, and receipts.',
    icon: <FinanceIcon />,
    requiredPermissions: ['finance.disburse', 'finance.export'],
    picklists: ['recipients'],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    description: 'Stock levels by product and location with available/reserved counts.',
    icon: <InventoryIcon />,
    requiredPermissions: ['inventory.read', 'inventory.export'],
    picklists: [],
  },
  {
    key: 'finance_invoices',
    label: 'Invoices',
    description: 'Invoice records with reference, amount, status, and due date.',
    icon: <FinanceIcon />,
    requiredPermissions: ['finance.read', 'finance.export'],
    picklists: [],
  },
  {
    key: 'logistics_locations',
    label: 'Logistics Locations',
    description: 'Logistics partner locations with order counts, delivery rates, and stock.',
    icon: <LogisticsIcon />,
    requiredPermissions: ['logistics.providers.view', 'logistics.export'],
    picklists: [],
  },
  {
    key: 'logistics_partners',
    label: 'Logistics Partners',
    description: 'Partner company performance: delivery rates, remittance, and stock.',
    icon: <LogisticsIcon />,
    requiredPermissions: ['logistics.providers.view', 'logistics.export'],
    picklists: ['products'],
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

function TeamIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}

function MarketingIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
    </svg>
  );
}

function FinanceIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
    </svg>
  );
}

function InventoryIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  );
}

function LogisticsIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
    </svg>
  );
}

/* ── Main component ──────────────────────────────────────────── */

export interface ExportPageProps {
  permissions: string[];
  picklists: ExportModalPicklists;
}

export function ExportPage({ permissions, picklists }: ExportPageProps) {
  const [selectedKey, setSelectedKey] = useState<ExportReportKey | null>(null);

  const permSet = useMemo(() => {
    const s = new Set<string>();
    for (const p of permissions) s.add(canonicalPermissionCode(p));
    return s;
  }, [permissions]);

  const isAdminBypass = permSet.has('ceo.overview') || permissions.length > 50;

  const visibleReports = useMemo(() => {
    return REPORT_TYPES.filter((r) => {
      if (isAdminBypass) return true;
      return r.requiredPermissions.every((p) => permSet.has(canonicalPermissionCode(p)));
    });
  }, [permSet, isAdminBypass]);

  const selectedConfig: ExportConfig | null = selectedKey ? EXPORT_CONFIGS[selectedKey] ?? null : null;

  // Build picklists for the selected report type (only pass what it needs)
  const selectedPicklists = useMemo(() => {
    if (!selectedKey) return {};
    const def = REPORT_TYPES.find((r) => r.key === selectedKey);
    if (!def) return {};
    const result: Partial<ExportModalPicklists> = {};
    for (const k of def.picklists) {
      if (picklists[k]) (result as Record<string, unknown>)[k] = picklists[k];
    }
    return result;
  }, [selectedKey, picklists]);

  return (
    <div>
      <PageHeader title="Export" description="Generate reports across all domains." />

      {visibleReports.length === 0 ? (
        <div className="mt-8 text-center text-sm text-app-fg-muted">
          No report types available for your permissions.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleReports.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setSelectedKey(r.key)}
              className={`text-left rounded-xl border p-4 transition-all duration-150 ${
                selectedKey === r.key
                  ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/30'
                  : 'border-app-border bg-app-elevated hover:border-brand-300 hover:bg-app-hover'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                    selectedKey === r.key
                      ? 'bg-brand-500/20 text-brand-600 dark:text-brand-400'
                      : 'bg-app-hover text-app-fg-muted'
                  }`}
                >
                  {r.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-app-fg">{r.label}</p>
                  <p className="text-xs text-app-fg-muted mt-0.5 line-clamp-2">{r.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Export modal — opens when a report type is selected */}
      {selectedConfig && (
        <ExportModal
          open={!!selectedKey}
          onClose={() => setSelectedKey(null)}
          config={selectedConfig}
          picklists={selectedPicklists}
        />
      )}
    </div>
  );
}
