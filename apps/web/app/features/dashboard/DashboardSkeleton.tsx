import { Link } from '@remix-run/react';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { StatValuePulse } from '~/components/ui/deferred-skeletons';
import { isSuperAdminOnly } from '~/lib/rbac';

function dashboardGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const FUNNEL_LABELS = [
  'Total',
  'Unassigned',
  'Assigned',
  'Unconfirmed',
  'Confirmed',
  'Delivered',
  'Remitted',
  'CR',
  'DR',
  'Deleted',
] as const;

function pulseStrip(labels: readonly string[], tileClassName = '!py-2.5') {
  return (
    <OverviewStatStrip
      tileClassName={tileClassName}
      items={labels.map((label) => ({
        label,
        value: <StatValuePulse className="min-w-[2.25rem]" />,
      }))}
    />
  );
}

function SectionStrip({ title, labels }: { title: string; labels: readonly string[] }) {
  return (
    <div>
      <h2 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-3">
        {title}
      </h2>
      {pulseStrip(labels)}
    </div>
  );
}

/**
 * Loading shell for the Super-Admin executive dashboard (`SuperAdminDashboard`).
 * Mirrors that layout: date filters, matrix strips (ROAS → funnels → spend →
 * profit → remittance), then quick nav. Used for both the route-transition
 * shell and the in-route CachedAwait fallback so they do not flash different UI.
 */
export function SuperAdminDashboardLoadingShell({
  userName,
  filters,
}: {
  userName: string;
  filters?: { startDate: string; endDate: string; periodAllTime?: boolean };
}) {
  const firstName = userName?.split(' ')[0] ?? 'Admin';

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title={`${dashboardGreeting()}, ${firstName}`}
        mobileInlineActions
        description="Executive dashboard. Key business metrics at a glance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Dashboard date range"
            saveFilterKey
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters?.startDate ?? ''}
                  endDate={filters?.endDate ?? ''}
                  periodAllTime={filters?.periodAllTime ?? false}
                  chrome="pill"
                />
              </>
            }
            sheet={
              <p className="text-sm text-app-fg-muted text-center py-1">
                Date range and refresh are on the toolbar. Use Save filters below to remember this view.
              </p>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters?.startDate ?? ''}
        endDate={filters?.endDate ?? ''}
        periodAllTime={filters?.periodAllTime ?? false}
      />

      {pulseStrip(['ROAS', 'Delivered revenue', 'Ad spend', 'Deep analysis'])}

      <SectionStrip title="Total Orders" labels={FUNNEL_LABELS} />

      <div className="space-y-4">
        <SectionStrip title="Order Funnel" labels={FUNNEL_LABELS} />
        <SectionStrip title="Cart Orders" labels={FUNNEL_LABELS} />
        <SectionStrip title="Offline Orders" labels={FUNNEL_LABELS} />
      </div>

      <SectionStrip title="Follow-Up Orders" labels={FUNNEL_LABELS} />
      <SectionStrip title="Delivered Follow-Up" labels={FUNNEL_LABELS} />

      <SectionStrip
        title="Marketing Spend"
        labels={['Total Ad Spend', 'Marketing Orders', 'Cost Per Acquisition']}
      />

      <div className="space-y-4">
        <SectionStrip
          title="Revenue & Profit"
          labels={['Revenue', 'Total Expenses', 'True Profit', 'Margin']}
        />
        <SectionStrip title="Remittance" labels={['Remitted', 'Awaiting Remittance']} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {['Sales Orders', 'Logistics', 'Marketing', 'Finance'].map((label) => (
          <div key={label} className="card text-center py-4">
            <span className="text-sm font-medium text-app-fg">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Admin quick-overview skeleton — mirrors AdminQuickDashboard layout exactly.
 */
export function AdminQuickDashboardLoadingShell({
  userName,
  role,
}: {
  userName: string;
  role: string;
}) {
  const firstName = userName?.split(' ')[0] ?? 'Admin';
  const greeting = dashboardGreeting();

  const description = isSuperAdminOnly({ role })
    ? 'Quick snapshot: open the Executive Overview for the full picture.'
    : "Quick snapshot of today's performance.";

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title={`${greeting}, ${firstName}`}
        mobileInlineActions
        description={description}
        actions={
          <>
            <span className="hidden md:inline-flex">
              <PageRefreshButton />
            </span>
            <span className="md:hidden">
              <PageRefreshButton iconOnly />
            </span>
          </>
        }
      />

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-app-fg">Order Funnel</h2>
          <Link
            to="/admin/sales/orders"
            prefetch="intent"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            View all →
          </Link>
        </div>
        <OverviewStatStrip
          embedded
          showScrollControls={false}
          items={[
            { label: 'Total', value: <StatValuePulse className="min-w-[2.25rem]" /> },
            { label: 'Unassigned', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Assigned', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Unconfirmed', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Confirmed', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Delivered', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'CR', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'DR', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Cart Abandonment', value: <StatValuePulse className="min-w-[2rem]" /> },
          ]}
        />
      </div>

      <Link to="/admin/ceo" className="card block hover:bg-app-hover/40 transition-colors">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-brand-600 dark:text-brand-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-app-fg">Executive Overview</h2>
              <svg
                className="w-5 h-5 text-app-fg-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </div>
            <p className="text-sm text-app-fg-muted mt-1">
              Revenue, true profit, cost breakdown, order pipeline, media buyer &amp; CS
              performance, branch breakdown. Heavier page, loads in 1-2 seconds.
            </p>
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { to: '/admin/sales/orders', label: 'Sales Orders' },
          { to: '/admin/logistics/orders', label: 'Logistics' },
          { to: '/admin/marketing', label: 'Marketing' },
          { to: '/admin/finance/overview', label: 'Finance' },
        ].map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className="card text-center py-4 hover:bg-app-hover/40 transition-colors"
          >
            <span className="text-sm font-medium text-app-fg">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Loading skeleton for the role-based dashboard (non-admin variant).
 * Header + date row + matrix funnel strip so it does not flash the old tile grid.
 */
export function DashboardSkeleton({
  userName = 'User',
  filters,
}: {
  userName?: string;
  filters?: { startDate: string; endDate: string; periodAllTime?: boolean };
} = {}) {
  const firstName = userName?.split(' ')[0] ?? 'User';

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title={`${dashboardGreeting()}, ${firstName}`}
        mobileInlineActions
        description="Your dashboard overview."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Dashboard date range"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters?.startDate ?? ''}
                  endDate={filters?.endDate ?? ''}
                  periodAllTime={filters?.periodAllTime ?? false}
                  chrome="pill"
                />
              </>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters?.startDate ?? ''}
        endDate={filters?.endDate ?? ''}
        periodAllTime={filters?.periodAllTime ?? false}
      />

      <SectionStrip title="Orders" labels={FUNNEL_LABELS} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-app-fg">Activity</h2>
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 w-full rounded bg-app-border/60 animate-pulse" />
            ))}
          </div>
        </div>
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-app-fg">Shortcuts</h2>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-app-border/40 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
