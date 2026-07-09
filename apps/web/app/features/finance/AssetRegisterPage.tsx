import { useMemo, useState } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { StatusBadge } from '~/components/ui/status-badge';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { NairaPrice } from '~/components/ui/naira-price';
import { SearchInput } from '~/components/ui/search-input';
import { Tabs } from '~/components/ui/tabs';
import { TableActionButton } from '~/components/ui/table-action-button';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';

// ── Types ────────────────────────────────────────────────────────────

export interface AssetRow {
  id: string;
  assetName: string;
  assetCategory: string;
  acquisitionDate: string;
  cost: string;
  residualValue: string;
  accumulatedDepreciation: string;
  nbv: string;
  depreciationMethod: 'STRAIGHT_LINE' | 'REDUCING_BALANCE';
  usefulLifeMonths: number | null;
  depreciationRate: number | null;
  status: 'ACTIVE' | 'FULLY_DEPRECIATED' | 'DISPOSED';
  location: string | null;
  serialNumber: string | null;
  notes: string | null;
  disposalDate: string | null;
  disposalProceeds: string | null;
}

export interface AssetRegisterPageProps {
  records: AssetRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
  summary: {
    totalAssets: number;
    totalCost: string;
    totalAccumulatedDepreciation: string;
    totalNbv: string;
  };
  canWrite: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: 'Motor Vehicles', label: 'Motor Vehicles' },
  { value: 'Computers & IT', label: 'Computers & IT' },
  { value: 'Furniture & Fittings', label: 'Furniture & Fittings' },
  { value: 'Plant & Machinery', label: 'Plant & Machinery' },
  { value: 'Software', label: 'Software' },
  { value: 'Land', label: 'Land' },
  { value: 'Buildings', label: 'Buildings' },
];

const METHOD_OPTIONS = [
  { value: 'STRAIGHT_LINE', label: 'Straight Line' },
  { value: 'REDUCING_BALANCE', label: 'Reducing Balance' },
];

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'FULLY_DEPRECIATED', label: 'Fully Depreciated' },
  { value: 'DISPOSED', label: 'Disposed' },
];

const METHOD_LABELS: Record<string, string> = {
  STRAIGHT_LINE: 'SLM',
  REDUCING_BALANCE: 'RBM',
};

// ── Component ────────────────────────────────────────────────────────

export function AssetRegisterPage({
  records,
  pagination,
  summary,
  canWrite,
}: AssetRegisterPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('status') || 'all';
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') ?? '');

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [disposeTarget, setDisposeTarget] = useState<AssetRow | null>(null);
  const [showDepreciationModal, setShowDepreciationModal] = useState(false);

  // Fetchers
  const createFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const disposeFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const depreciationFetcher = useFetcher<{ success?: boolean; error?: string }>();

  useFetcherToast(createFetcher.data);
  useFetcherToast(disposeFetcher.data);
  useFetcherToast(depreciationFetcher.data);

  useCloseOnFetcherSuccess(createFetcher, () => setShowAddModal(false));
  useCloseOnFetcherSuccess(disposeFetcher, () => setDisposeTarget(null));
  useCloseOnFetcherSuccess(depreciationFetcher, () => setShowDepreciationModal(false));

  // Add asset form state
  const [depMethod, setDepMethod] = useState('STRAIGHT_LINE');

  // Depreciation modal defaults
  const now = new Date();
  const [depMonth, setDepMonth] = useState(now.getMonth() + 1);
  const [depYear, setDepYear] = useState(now.getFullYear());

  // ── Tab / search handlers ──────────────────────────────────────────

  function handleTabChange(value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === 'all') {
        next.delete('status');
      } else {
        next.set('status', value);
      }
      next.delete('page');
      return next;
    });
  }

  function handleSearch(value: string) {
    setSearchQuery(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set('search', value);
      } else {
        next.delete('search');
      }
      next.delete('page');
      return next;
    });
  }

  // ── Columns ────────────────────────────────────────────────────────

  const columns = useMemo(
    (): CompactTableColumn<AssetRow>[] => [
      {
        key: 'assetName',
        header: 'Asset Name',
        render: (r) => (
          <div>
            <span className="font-medium text-app-fg">{r.assetName}</span>
            {r.serialNumber && (
              <span className="ml-1.5 text-xs text-app-fg-muted">#{r.serialNumber}</span>
            )}
          </div>
        ),
      },
      {
        key: 'assetCategory',
        header: 'Category',
        render: (r) => <span className="text-app-fg">{r.assetCategory}</span>,
      },
      {
        key: 'acquisitionDate',
        header: 'Acquired',
        render: (r) => <span className="text-app-fg">{r.acquisitionDate}</span>,
      },
      {
        key: 'cost',
        header: 'Cost',
        align: 'right',
        render: (r) => <NairaPrice amount={r.cost} />,
      },
      {
        key: 'accDep',
        header: 'Acc. Dep',
        align: 'right',
        render: (r) => <NairaPrice amount={r.accumulatedDepreciation} />,
      },
      {
        key: 'nbv',
        header: 'NBV',
        align: 'right',
        render: (r) => <NairaPrice amount={r.nbv} />,
      },
      {
        key: 'method',
        header: 'Method',
        render: (r) => (
          <span className="text-xs text-app-fg-muted">{METHOD_LABELS[r.depreciationMethod] ?? r.depreciationMethod}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => <StatusBadge status={r.status} />,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        render: (r) =>
          canWrite && r.status === 'ACTIVE' ? (
            <TableActionButton onClick={() => setDisposeTarget(r)}>Dispose</TableActionButton>
          ) : null,
      },
    ],
    [canWrite],
  );

  // ── Mobile card ────────────────────────────────────────────────────

  const renderMobileCard = useMemo(
    () => (r: AssetRow) => (
      <button
        type="button"
        className="w-full text-left p-3 space-y-1"
        onClick={() => {
          if (canWrite && r.status === 'ACTIVE') setDisposeTarget(r);
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-app-fg truncate">{r.assetName}</span>
          <StatusBadge status={r.status} />
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
          <span>{r.assetCategory}</span>
          <NairaPrice amount={r.nbv} className="font-medium" />
        </div>
      </button>
    ),
    [canWrite],
  );

  // ── Render ─────────────────────────────────────────────────────────

  const actions = canWrite ? (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" onClick={() => setShowDepreciationModal(true)}>
        Run Depreciation
      </Button>
      <Button type="button" onClick={() => setShowAddModal(true)}>
        + Add Asset
      </Button>
    </div>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Asset Register"
        description="Track fixed assets, depreciation, and disposals."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                {actions}
              </div>
            }
            sheet={
              canWrite ? (
                <div className="flex flex-col gap-2">
                  <Button type="button" variant="secondary" onClick={() => setShowDepreciationModal(true)}>
                    Run Depreciation
                  </Button>
                  <Button type="button" onClick={() => setShowAddModal(true)}>
                    + Add Asset
                  </Button>
                </div>
              ) : undefined
            }
            sheetTitle="Asset Register"
            triggerAriaLabel="Asset register actions"
          />
        }
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Tabs value={activeTab} onChange={handleTabChange} tabs={STATUS_TABS} variant="pill" />
          <SearchInput
            value={searchQuery}
            onChange={handleSearch}
            debounceMs={300}
            placeholder="Search assets..."
            clearable
            wrapperClassName="w-full md:w-64"
          />
        </div>
      </PageHeader>

      <OverviewStatStrip
        items={[
          { label: 'Total Assets', value: String(summary.totalAssets) },
          { label: 'Total Cost', value: <NairaPrice amount={summary.totalCost} /> },
          { label: 'Acc. Depreciation', value: <NairaPrice amount={summary.totalAccumulatedDepreciation} /> },
          { label: 'Total NBV', value: <NairaPrice amount={summary.totalNbv} /> },
        ]}
      />

      {records.length === 0 ? (
        <EmptyState
          title="No assets found"
          description="Add your first fixed asset to start tracking depreciation."
          action={
            canWrite ? (
              <Button type="button" onClick={() => setShowAddModal(true)}>
                + Add Asset
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <CompactTable
            columns={columns}
            rows={records}
            rowKey={(r) => r.id}
            renderMobileCard={renderMobileCard}
          />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} />
        </>
      )}

      {/* ── Add Asset Modal ──────────────────────────────────────────── */}
      {showAddModal && (
        <Modal open onClose={() => setShowAddModal(false)} maxWidth="max-w-lg">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Add Asset</h2>
            <createFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="createAsset" />

              <TextInput label="Asset Name" name="assetName" required />

              <FormSelect label="Category" name="assetCategory" required>
                <option value="">Select category</option>
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </FormSelect>

              <TextInput label="Acquisition Date" name="acquisitionDate" type="date" required />

              <div className="grid grid-cols-2 gap-3">
                <TextInput label="Cost" name="cost" type="number" min="0" step="0.01" required />
                <TextInput label="Residual Value" name="residualValue" type="number" min="0" step="0.01" defaultValue="0" />
              </div>

              <FormSelect
                label="Depreciation Method"
                name="depreciationMethod"
                value={depMethod}
                onChange={(e) => setDepMethod(e.target.value)}
              >
                {METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </FormSelect>

              {depMethod === 'STRAIGHT_LINE' && (
                <TextInput
                  label="Useful Life (months)"
                  name="usefulLifeMonths"
                  type="number"
                  min="1"
                  required
                />
              )}

              {depMethod === 'REDUCING_BALANCE' && (
                <TextInput
                  label="Depreciation Rate (%)"
                  name="depreciationRate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                />
              )}

              <TextInput label="Location" name="location" />
              <TextInput label="Serial Number" name="serialNumber" />
              <TextInput label="Notes" name="notes" />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createFetcher.state !== 'idle'}>
                  {createFetcher.state !== 'idle' ? 'Creating...' : 'Create Asset'}
                </Button>
              </div>
            </createFetcher.Form>
          </div>
        </Modal>
      )}

      {/* ── Dispose Asset Modal ──────────────────────────────────────── */}
      {disposeTarget && (
        <Modal open onClose={() => setDisposeTarget(null)} maxWidth="max-w-md">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">
              Dispose: {disposeTarget.assetName}
            </h2>
            <p className="text-sm text-app-fg-muted">
              NBV at disposal: <NairaPrice amount={disposeTarget.nbv} />
            </p>
            <disposeFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="disposeAsset" />
              <input type="hidden" name="assetId" value={disposeTarget.id} />

              <TextInput label="Disposal Date" name="disposalDate" type="date" required />
              <TextInput label="Proceeds" name="proceeds" type="number" min="0" step="0.01" defaultValue="0" />
              <TextInput label="Reason" name="reason" />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setDisposeTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={disposeFetcher.state !== 'idle'}>
                  {disposeFetcher.state !== 'idle' ? 'Disposing...' : 'Dispose Asset'}
                </Button>
              </div>
            </disposeFetcher.Form>
          </div>
        </Modal>
      )}

      {/* ── Run Depreciation Modal ───────────────────────────────────── */}
      {showDepreciationModal && (
        <Modal open onClose={() => setShowDepreciationModal(false)} maxWidth="max-w-sm">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Run Depreciation</h2>
            <p className="text-sm text-app-fg-muted">
              Post monthly depreciation entries for all active assets.
            </p>
            <depreciationFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="runDepreciation" />

              <div className="grid grid-cols-2 gap-3">
                <FormSelect
                  label="Month"
                  name="month"
                  value={String(depMonth)}
                  onChange={(e) => setDepMonth(parseInt(e.target.value, 10))}
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {new Date(2000, i).toLocaleString('en', { month: 'long' })}
                    </option>
                  ))}
                </FormSelect>
                <TextInput
                  label="Year"
                  name="year"
                  type="number"
                  value={String(depYear)}
                  onChange={(e) => setDepYear(parseInt((e.target as HTMLInputElement).value, 10))}
                  min="2020"
                  max="2099"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowDepreciationModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={depreciationFetcher.state !== 'idle'}>
                  {depreciationFetcher.state !== 'idle' ? 'Running...' : 'Run Depreciation'}
                </Button>
              </div>
            </depreciationFetcher.Form>
          </div>
        </Modal>
      )}
    </>
  );
}
