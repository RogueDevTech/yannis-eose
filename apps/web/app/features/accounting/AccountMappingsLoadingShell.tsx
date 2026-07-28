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
        title="Account Config"
        mobileInlineActions
        description="Manage the chart of accounts and wire posting keys to the right GL accounts."
      />

      <OverviewStatStrip
        items={[
          { label: 'TOTAL', value: <StatValuePulse /> },
          { label: 'ACTIVE', value: <StatValuePulse /> },
          { label: 'GROUPS', value: <StatValuePulse /> },
          { label: 'POSTABLE', value: <StatValuePulse /> },
        ]}
      />

      <div className="space-y-2">
        <CardPulseRows count={8} />
      </div>
    </div>
  );
}
