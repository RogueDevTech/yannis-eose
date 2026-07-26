import { useMemo, useState, useCallback } from 'react';
import { useFetcher, Link } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { TextInput } from '~/components/ui/text-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { RealMoneyTag } from '~/components/ui/real-money-tag';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useOptimisticListMerge } from '~/hooks/useOptimisticListMerge';
import {
  applyOptimisticPatches,
  useOptimisticListPatches,
} from '~/hooks/useOptimisticListPatches';
import { optimisticId } from '~/lib/optimistic';
import { useFetcherToast } from '~/components/ui/toast';

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  rootType: string;
  accountType: string | null;
  isGroup: boolean;
  parentAccountId: string | null;
  balance: string;
  isActive: boolean;
}

export interface ChartOfAccountsPageProps {
  accounts: AccountRow[];
  canWrite: boolean;
  hasOpeningBalances?: boolean;
}

const ROOT_TYPES = [
  { value: 'ASSET', label: 'Asset' },
  { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expense' },
];

const ACCOUNT_TYPES = [
  'BANK', 'CASH', 'RECEIVABLE', 'PAYABLE', 'STOCK', 'COST_OF_GOODS_SOLD',
  'TAX', 'FIXED_ASSET', 'INDIRECT_EXPENSE', 'INDIRECT_INCOME', 'DIRECT_INCOME',
  'EQUITY', 'ROUND_OFF', 'TEMPORARY', 'DEPRECIATION', 'EXPENSE_ACCOUNT',
  'CHARGEABLE', 'STOCK_RECEIVED_BUT_NOT_BILLED',
].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: '1', label: '1000s Assets' },
  { value: '2', label: '2000s Liabilities' },
  { value: '3', label: '3000s Equity' },
  { value: '4', label: '4000s Revenue' },
  { value: '5', label: '5000s Cost of Sales' },
  { value: '6', label: '6000s Operating Expenses' },
  { value: '7', label: '7000s Other Income/Finance' },
  { value: '8', label: '8000s Tax' },
  { value: '9', label: '9000s System' },
];

/** Replace em dashes with dot separators in display names. */
function displayName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s*[—–]\s*/g, ' · ');
}


/** Normal balance based on root type per IFRS. */
function normalBalance(rootType: string): 'Debit' | 'Credit' {
  return rootType === 'ASSET' || rootType === 'EXPENSE' ? 'Debit' : 'Credit';
}

/** Human label for a semantic account type tag. */
function typeLabel(accountType: string | null): string {
  if (!accountType) return '';
  const words = accountType.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Order accounts as a tree (parent immediately above its children) + depth. */
function toTree(accounts: AccountRow[]): Array<AccountRow & { depth: number }> {
  const byParent = new Map<string | null, AccountRow[]>();
  for (const a of accounts) {
    const key = a.parentAccountId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(a);
  }
  const out: Array<AccountRow & { depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.code.localeCompare(b.code));
    for (const c of children) {
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  const seen = new Set(out.map((o) => o.id));
  for (const a of accounts) if (!seen.has(a.id)) out.push({ ...a, depth: 0 });
  return out;
}

export function ChartOfAccountsPage({
  accounts: accountsProp,
  canWrite,
  hasOpeningBalances = false,
}: ChartOfAccountsPageProps) {
  const serverAccounts = Array.isArray(accountsProp) ? accountsProp : [];
  const [createOpen, setCreateOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<AccountRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AccountRow | null>(null);
  const [parentId, setParentId] = useState('');
  const [search, setSearch] = useState('');
  const [rootTypeFilter, setRootTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [postableOnly, setPostableOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    // Start with only the first top-level group (Assets) expanded
    for (const a of serverAccounts) {
      if (a.isGroup && !a.parentAccountId) return new Set([a.id]);
    }
    return new Set<string>();
  });
  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const editFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const deactivateFetcher = useFetcher<{ success?: boolean; error?: string }>();

  useFetcherToast(createFetcher.data);
  useFetcherToast(editFetcher.data);
  useFetcherToast(deactivateFetcher.data);

  useCloseOnFetcherSuccess(createFetcher, () => {
    setCreateOpen(false);
    setParentId('');
  });
  useCloseOnFetcherSuccess(editFetcher, () => setEditAccount(null));

  const buildCreateRows = useCallback((fd: FormData, intent: string) => {
    if (intent !== 'createAccount') return null;
    const code = fd.get('code')?.toString()?.trim();
    const name = fd.get('name')?.toString()?.trim();
    const rootType = fd.get('rootType')?.toString()?.trim();
    if (!code || !name || !rootType) return null;
    const accountType = fd.get('accountType')?.toString()?.trim() || null;
    const parentAccountId = fd.get('parentAccountId')?.toString()?.trim() || null;
    const isGroup = fd.get('isGroup') === 'true';
    return [
      {
        id: optimisticId('account'),
        code,
        name,
        rootType,
        accountType,
        isGroup,
        parentAccountId,
        balance: '0',
        isActive: true,
      } satisfies AccountRow,
    ];
  }, []);

  const buildEditPatches = useCallback((fd: FormData, intent: string) => {
    if (intent !== 'updateAccount') return null;
    const id = fd.get('accountId')?.toString();
    const name = fd.get('name')?.toString()?.trim();
    if (!id || !name) return null;
    return [{ id, patch: { name } }];
  }, []);
  const buildDeactivatePatches = useCallback((fd: FormData, intent: string) => {
    if (intent !== 'deactivateAccount') return null;
    const id = fd.get('accountId')?.toString();
    if (!id) return null;
    return [{ id, patch: { isActive: false } }];
  }, []);

  const optimisticCreated = useOptimisticListMerge<AccountRow>(createFetcher, buildCreateRows);
  const editPatches = useOptimisticListPatches<AccountRow>(editFetcher, buildEditPatches);
  const deactivatePatches = useOptimisticListPatches<AccountRow>(
    deactivateFetcher,
    buildDeactivatePatches,
  );
  const accounts = useMemo(() => {
    const merged = [...optimisticCreated, ...serverAccounts];
    const afterEdit = applyOptimisticPatches(merged, editPatches);
    return applyOptimisticPatches(afterEdit, deactivatePatches);
  }, [optimisticCreated, serverAccounts, editPatches, deactivatePatches]);

  // Apply status filter first (active/inactive/all)
  const statusFiltered = useMemo(() => {
    if (statusFilter === 'active') return accounts.filter((a) => a.isActive);
    if (statusFilter === 'inactive') return accounts.filter((a) => !a.isActive);
    return accounts;
  }, [accounts, statusFilter]);

  const tree = useMemo(() => toTree(statusFiltered), [statusFiltered]);

  const rows = useMemo(() => {
    let filtered = tree;
    const q = search.trim().toLowerCase();
    const hasFilters = !!(q || rootTypeFilter || categoryFilter || postableOnly);

    if (q) {
      filtered = filtered
        .filter((a) => `${a.code} ${a.name}`.toLowerCase().includes(q))
        .map((a) => ({ ...a, depth: 0 }));
    }
    if (rootTypeFilter) {
      filtered = filtered.filter((a) => a.rootType === rootTypeFilter);
    }
    if (categoryFilter) {
      filtered = filtered.filter((a) => a.code.startsWith(categoryFilter));
    }
    if (postableOnly) {
      filtered = filtered.filter((a) => !a.isGroup);
    }

    // When no search/filter active, apply accordion collapse
    if (!hasFilters) {
      const visible: typeof filtered = [];
      for (const row of filtered) {
        // Check if all ancestor groups are expanded
        let ancestorId = row.parentAccountId ?? null;
        let ancestorVisible = true;
        while (ancestorId) {
          if (!expandedGroups.has(ancestorId)) {
            ancestorVisible = false;
            break;
          }
          const parent = filtered.find((r) => r.id === ancestorId);
          ancestorId = parent?.parentAccountId ?? null;
        }
        if (ancestorVisible) visible.push(row);
      }
      return visible;
    }

    return filtered;
  }, [tree, search, rootTypeFilter, categoryFilter, postableOnly, expandedGroups]);

  const parentOptions = useMemo(
    () => accounts.filter((a) => a.isGroup).map((a) => ({ value: a.id, label: `${a.code} ${a.name.replace(/\s*[—–]\s*/g, ' · ')}` })),
    [accounts],
  );

  const groupCount = statusFiltered.filter((a) => a.isGroup).length;
  const activeCount = accounts.filter((a) => a.isActive).length;
  const inactiveCount = accounts.length - activeCount;

  const handleDeactivateConfirm = useCallback(() => {
    if (!deactivateTarget) return;
    deactivateFetcher.submit(
      { intent: 'deactivateAccount', accountId: deactivateTarget.id },
      { method: 'post' },
    );
    setDeactivateTarget(null);
  }, [deactivateFetcher, deactivateTarget]);

  const hasFilters = Boolean(rootTypeFilter || categoryFilter || postableOnly || statusFilter !== 'active' || search.trim());
  const filtersBadgeCount =
    (rootTypeFilter ? 1 : 0) +
    (categoryFilter ? 1 : 0) +
    (postableOnly ? 1 : 0) +
    (statusFilter !== 'active' ? 1 : 0) +
    (search.trim() ? 1 : 0);
  const resetFilters = () => {
    setRootTypeFilter('');
    setCategoryFilter('');
    setPostableOnly(false);
    setStatusFilter('active');
    setSearch('');
  };

  const filterControls = (
    <>
      <FormSelect
        label="Type"
        value={rootTypeFilter}
        onChange={(e) => setRootTypeFilter(e.target.value)}
        options={[{ value: '', label: 'All types' }, ...ROOT_TYPES]}
      />
      <FormSelect
        label="Category"
        value={categoryFilter}
        onChange={(e) => setCategoryFilter(e.target.value)}
        options={CATEGORY_OPTIONS}
      />
      <FormSelect
        label="Status"
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
          { value: 'all', label: 'All' },
        ]}
      />
      <label className="flex items-center gap-1.5 text-xs text-app-fg-muted cursor-pointer select-none pt-5">
        <input
          type="checkbox"
          checked={postableOnly}
          onChange={(e) => setPostableOnly(e.target.checked)}
          className="rounded border-app-border text-brand-600 focus:ring-brand-500"
        />
        Postable only
      </label>
    </>
  );


  return (
    <div className="space-y-4">
      <PageHeader
        title="Chart of Accounts"
        description="IFRS-compliant account tree for double-entry ledger postings."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Chart of accounts tools"
            saveFilterKey
            filtersBadgeCount={filtersBadgeCount}
            onClearFilters={hasFilters ? resetFilters : undefined}
            filters={
              <>
                <PageSearchControl
                  value={search}
                  onApply={setSearch}
                  placeholder="Search by code or name"
                  title="Search accounts"
                />
                {filterControls}
              </>
            }
            desktop={
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <PageRefreshButton />
                {canWrite && (
                  <Link to="/admin/finance/opening-balances" className="btn-secondary btn-sm inline-flex items-center">
                    {hasOpeningBalances ? 'View Opening Balances' : 'Post Opening Balances'}
                  </Link>
                )}
                {canWrite ? (
                  <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                    New Account
                  </Button>
                ) : null}
              </div>
            }
            sheet={
              canWrite ? (
                <>
                  <Link to="/admin/finance/opening-balances" className="btn-secondary w-full flex items-center justify-center">
                    {hasOpeningBalances ? 'View Opening Balances' : 'Post Opening Balances'}
                  </Link>
                  <Button type="button" className="w-full" onClick={() => setCreateOpen(true)}>
                    New Account
                  </Button>
                </>
              ) : undefined
            }
          />
        }
      />

      <MobileDateFilterRow
        hideDate
        actionsSheet={
          canWrite ? (
            <>
              {!hasOpeningBalances && (
                <Link to="/admin/finance/opening-balances" className="btn-secondary w-full flex items-center justify-center">
                  Post Opening Balances
                </Link>
              )}
              <Button type="button" className="w-full" onClick={() => setCreateOpen(true)}>
                New Account
              </Button>
            </>
          ) : undefined
        }
        actionsSheetTitle="Actions"
      />

      <OverviewStatStrip
        items={[
          { label: 'Total', value: String(accounts.length) },
          { label: 'Active', value: String(activeCount) },
          { label: 'Groups', value: String(groupCount) },
          { label: 'Postable', value: String(statusFiltered.length - groupCount) },
          ...(inactiveCount > 0 ? [{ label: 'Inactive', value: String(inactiveCount), valueClassName: 'text-app-fg-muted' }] : []),
        ]}
      />

      {canWrite && !hasOpeningBalances && (
        <div className="rounded-lg border border-warning-200 dark:border-warning-800 bg-warning-50/60 dark:bg-warning-900/20 px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-warning-800 dark:text-warning-200">Opening balances not posted</p>
            <p className="text-xs text-warning-700 dark:text-warning-300 mt-0.5">
              Post your go-live account balances so the ledger starts with the correct snapshot.
            </p>
          </div>
          <Link to="/admin/finance/opening-balances" className="btn-primary btn-sm inline-flex items-center shrink-0">
            Post now
          </Link>
        </div>
      )}

      <div className="hidden md:flex flex-wrap items-center gap-2">
        <PageSearchControl
          value={search}
          onApply={setSearch}
          placeholder="Search by code or name"
          title="Search accounts"
        />
        <FormSelect
          value={rootTypeFilter}
          onChange={(e) => setRootTypeFilter(e.target.value)}
          options={[{ value: '', label: 'All types' }, ...ROOT_TYPES]}
          className="w-36"
        />
        <FormSelect
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          options={CATEGORY_OPTIONS}
          className="w-48"
        />
        <FormSelect
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'all', label: 'All' },
          ]}
          className="w-32"
        />
        <label className="flex items-center gap-1.5 text-xs text-app-fg-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={postableOnly}
            onChange={(e) => setPostableOnly(e.target.checked)}
            className="rounded border-app-border text-brand-600 focus:ring-brand-500"
          />
          Postable only
        </label>
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="text-xs text-brand-600 hover:underline">
            Reset
          </button>
        )}
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          description="The chart of accounts seeds automatically on server boot. Create one manually if needed."
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No matches" description="No accounts match the current filters." />
      ) : (
        <div className="card !p-0 overflow-hidden">
          <div className="divide-y divide-app-border">
            {rows.map((r) => {
              const isExpanded = expandedGroups.has(r.id);
              const hasChildren = r.isGroup && tree.some((t) => t.parentAccountId === r.id);
              // Cap tree indent so nested rows don't shove name/balance off-screen on mobile.
              const indentPx = 12 + Math.min(r.depth, 3) * 12;
              const balanceNonZero = !r.isGroup && Number(r.balance) !== 0;
              return (
                <div
                  key={r.id}
                  className={`px-3 py-2.5 sm:px-4 ${r.isGroup ? 'bg-app-hover/30' : ''} ${!r.isActive ? 'opacity-50' : ''}`}
                  style={{ paddingLeft: `${indentPx}px` }}
                >
                  <div className="flex items-start md:items-center gap-2 sm:gap-3 min-w-0">
                    {/* Chevron / spacer */}
                    {r.isGroup && hasChildren ? (
                      <button
                        type="button"
                        onClick={() => toggleGroup(r.id)}
                        className="shrink-0 p-0.5 mt-0.5 md:mt-0 rounded hover:bg-app-hover text-app-fg-muted"
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        <svg
                          className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}

                    {/* Code — desktop inline; mobile moves to meta row */}
                    <span className="hidden md:inline text-xs font-mono text-app-fg-muted w-14 shrink-0 tabular-nums">
                      {r.code}
                    </span>

                    {/* Name: full remaining width on mobile (wrap); 40% + truncate on desktop */}
                    <div className="min-w-0 flex-1 basis-0 md:w-[40%] md:flex-none md:max-w-[40%] md:basis-auto">
                      <div className="flex items-start justify-between gap-3 min-w-0">
                        {r.isGroup ? (
                          <span className={`min-w-0 flex-1 text-sm font-semibold text-app-fg break-words md:truncate ${!r.isActive ? 'line-through' : ''}`}>
                            {displayName(r.name)}
                            <span className="hidden md:inline">
                              <RealMoneyTag accountType={r.accountType} />
                            </span>
                          </span>
                        ) : (
                          <Link
                            to={`/admin/finance/accounts/${r.id}`}
                            className={`min-w-0 flex-1 text-sm text-app-fg hover:text-brand-600 transition-colors break-words md:truncate ${!r.isActive ? 'line-through' : ''}`}
                          >
                            {displayName(r.name)}
                            <span className="hidden md:inline">
                              <RealMoneyTag accountType={r.accountType} />
                            </span>
                          </Link>
                        )}
                        {!r.isGroup && (
                          <Link
                            to={`/admin/finance/accounts/${r.id}`}
                            className="md:hidden shrink-0 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline pt-0.5"
                          >
                            View
                          </Link>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-app-fg-muted md:hidden">
                        <span className="font-mono tabular-nums">{r.code}</span>
                        <span>{r.rootType}</span>
                        {r.isGroup && (
                          <span className="rounded bg-app-hover px-1.5 py-0.5 text-[10px] uppercase">
                            group
                          </span>
                        )}
                        <RealMoneyTag accountType={r.accountType} />
                        {balanceNonZero && (
                          <span className="font-medium tabular-nums text-app-fg">
                            <NairaPrice amount={r.balance} />
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Desktop meta: right-aligned with even column spacing */}
                    <div className="hidden md:flex flex-1 items-center justify-end gap-6 min-w-0 pl-4">
                      {r.isGroup ? (
                        <span className="rounded bg-app-hover px-1.5 py-0.5 text-[10px] uppercase text-app-fg-muted shrink-0">
                          group
                        </span>
                      ) : (
                        <span className="w-10 shrink-0" aria-hidden />
                      )}
                      <span className="text-xs text-app-fg-muted w-20 shrink-0 text-right">
                        {r.rootType}
                      </span>
                      <span className="text-xs font-medium tabular-nums shrink-0 text-right w-28">
                        {balanceNonZero ? <NairaPrice amount={r.balance} /> : null}
                      </span>
                      {!r.isGroup ? (
                        <Link
                          to={`/admin/finance/accounts/${r.id}`}
                          className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline shrink-0 w-10 text-right"
                        >
                          View
                        </Link>
                      ) : (
                        <span className="w-10 shrink-0" aria-hidden />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {createOpen && (
        <Modal open onClose={() => setCreateOpen(false)} maxWidth="max-w-md">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">New Account</h2>
            <createFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="createAccount" />
              <TextInput label="Code" name="code" required placeholder="e.g. 1125" />
              <TextInput label="Name" name="name" required />
              <FormSelect name="rootType" label="Root type" options={ROOT_TYPES} required />
              <FormSelect
                name="accountType"
                label="Account type (optional)"
                options={[{ value: '', label: 'None' }, ...ACCOUNT_TYPES]}
              />
              <input type="hidden" name="parentAccountId" value={parentId} />
              <SearchableSelect
                label="Parent account (optional)"
                value={parentId}
                onChange={setParentId}
                options={parentOptions}
                clearable
              />
              <label className="flex items-center gap-2 text-sm text-app-fg">
                <input type="checkbox" name="isGroup" value="true" className="rounded border-app-border text-brand-600 focus:ring-brand-500" /> This is a group (header) account
              </label>
              {createFetcher.data?.error && (
                <p className="text-sm text-danger-600">{createFetcher.data.error}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createFetcher.state !== 'idle'}>
                  {createFetcher.state !== 'idle' ? 'Saving...' : 'Create'}
                </Button>
              </div>
            </createFetcher.Form>
          </div>
        </Modal>
      )}

      <ConfirmActionModal
        open={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        title="Deactivate account"
        description={
          deactivateTarget
            ? `Deactivate "${deactivateTarget.code} ${deactivateTarget.name.replace(/\s*[—–]\s*/g, ' · ')}"? It will no longer be selectable for new postings.`
            : ''
        }
        confirmLabel="Deactivate"
        variant="danger"
        loading={deactivateFetcher.state !== 'idle'}
        onConfirm={handleDeactivateConfirm}
      />

      {editAccount && (
        <Modal open onClose={() => setEditAccount(null)} maxWidth="max-w-md">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Account Details</h2>
            <p className="text-sm text-app-fg-muted">
              Only the account name can be changed. Code, type, and structure are locked after creation.
            </p>
            <editFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="updateAccount" />
              <input type="hidden" name="accountId" value={editAccount.id} />
              <TextInput label="Code" value={editAccount.code} disabled />
              <TextInput label="Name" name="name" defaultValue={editAccount.name} required />
              <div className="grid grid-cols-2 gap-3">
                <TextInput label="Root type" value={editAccount.rootType} disabled />
                <TextInput label="Normal balance" value={normalBalance(editAccount.rootType)} disabled />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextInput label="Account type" value={editAccount.accountType ? typeLabel(editAccount.accountType) : 'None'} disabled />
                <TextInput label="Group" value={editAccount.isGroup ? 'Yes (header)' : 'No (postable)'} disabled />
              </div>
              {editFetcher.data?.error && (
                <p className="text-sm text-danger-600">{editFetcher.data.error}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setEditAccount(null)}>
                  Cancel
                </Button>
                <Button type="submit" loading={editFetcher.state !== 'idle'} loadingText="Saving...">
                  Save
                </Button>
              </div>
            </editFetcher.Form>
          </div>
        </Modal>
      )}

    </div>
  );
}
