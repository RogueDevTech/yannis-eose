import { CompactTable } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';

export interface FormFailuresData {
  totals: { browserBlocked: number; formBlocked: number; serverRejected: number; total: number };
  forms: Array<{
    campaignId: string;
    campaignName: string;
    mediaBuyerName: string | null;
    browserBlocked: number;
    formBlocked: number;
    serverRejected: number;
    total: number;
    topReason: string | null;
    orders: number;
  }>;
  topReasons: Array<{ outcome: string; reason: string | null; count: number }>;
}

type FormRow = FormFailuresData['forms'][number];
type ReasonRow = FormFailuresData['topReasons'][number];

const OUTCOME_LABEL: Record<string, string> = {
  BROWSER_BLOCKED: 'Field refused',
  FORM_BLOCKED: 'Form check',
  SERVER_REJECTED: 'After sending',
};

/** Field keys the browser refused, shown as readable names. */
function readableReason(outcome: string, reason: string | null): string {
  if (!reason) return 'Unknown';
  if (outcome !== 'BROWSER_BLOCKED') return reason;
  const names: Record<string, string> = {
    customerName: 'Name',
    customerPhone: 'Phone',
    deliveryAddress: 'Address',
    deliveryState: 'State',
    customerEmail: 'Email',
  };
  return reason.split(',').map((k) => names[k] ?? k).join(', ');
}

export function FormFailuresView({ data }: { data: FormFailuresData }) {
  return (
    <div className="space-y-4">
      <OverviewStatStrip
        items={[
          { label: 'Failed submits', value: data.totals.total },
          { label: 'Field refused', value: data.totals.browserBlocked, title: 'The browser refused a field, for example a phone number in the wrong format.' },
          { label: 'Form check', value: data.totals.formBlocked, title: 'The form showed an error before sending, for example no offer chosen.' },
          { label: 'After sending', value: data.totals.serverRejected, title: 'The order was sent and an error came back.' },
        ]}
      />

      <CompactTable<FormRow>
        caption="Failed submits per form"
        rows={data.forms}
        rowKey={(r) => r.campaignId}
        rowHref={(r) => `/admin/marketing/analytics/${r.campaignId}`}
        emptyTitle="No failed submits"
        emptyDescription="Every submit in this period went through."
        columns={[
          {
            key: 'form',
            header: 'Form',
            render: (r) => (
              <div className="min-w-0">
                <p className="truncate font-medium text-app-fg">{r.campaignName}</p>
                {r.mediaBuyerName && <p className="truncate text-xs text-app-fg-muted">{r.mediaBuyerName}</p>}
              </div>
            ),
          },
          { key: 'total', header: 'Failed', align: 'right', render: (r) => <span className="font-semibold">{r.total}</span> },
          { key: 'orders', header: 'Orders', align: 'right', render: (r) => r.orders },
          { key: 'browser', header: 'Field refused', align: 'right', hideOnMobile: true, render: (r) => r.browserBlocked },
          { key: 'formCheck', header: 'Form check', align: 'right', hideOnMobile: true, render: (r) => r.formBlocked },
          { key: 'server', header: 'After sending', align: 'right', hideOnMobile: true, render: (r) => r.serverRejected },
          {
            key: 'reason',
            header: 'Most common',
            render: (r) => <span className="text-xs text-app-fg-muted">{r.topReason ?? 'Unknown'}</span>,
          },
        ]}
      />

      {data.topReasons.length > 0 && (
        <CompactTable<ReasonRow>
          caption="Top reasons"
          rows={data.topReasons}
          rowKey={(r) => `${r.outcome}:${r.reason ?? ''}`}
          columns={[
            { key: 'reason', header: 'Reason', render: (r) => readableReason(r.outcome, r.reason) },
            { key: 'type', header: 'Where', render: (r) => <span className="text-xs text-app-fg-muted">{OUTCOME_LABEL[r.outcome] ?? r.outcome}</span> },
            { key: 'count', header: 'Count', align: 'right', render: (r) => <span className="font-semibold">{r.count}</span> },
          ]}
        />
      )}
    </div>
  );
}
