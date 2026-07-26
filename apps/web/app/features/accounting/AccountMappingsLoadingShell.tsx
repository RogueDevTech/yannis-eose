import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { StatValuePulse } from '~/components/ui/deferred-skeletons';

function CardPulseRows({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="h-14 w-full rounded-md bg-app-hover/40 animate-pulse"
          aria-hidden
        />
      ))}
    </div>
  );
}

export function AccountMappingsLoadingShell({ canWrite: _canWrite }: { canWrite: boolean }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Account Mappings"
        mobileInlineActions
        description="Configure which GL accounts the auto-posting engine uses."
      />

      <OverviewStatStrip
        items={[
          { label: 'TOTAL', value: <StatValuePulse /> },
          { label: 'CUSTOM', value: <StatValuePulse /> },
          { label: 'DEFAULT', value: <StatValuePulse /> },
        ]}
      />

      <div className="space-y-6">
        {['Assets', 'Liabilities', 'Equity'].map((cat) => (
          <div key={cat}>
            <h3 className="text-sm font-semibold text-app-fg-muted mb-2">{cat}</h3>
            <CardPulseRows count={3} />
          </div>
        ))}
      </div>
    </div>
  );
}
