import { useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { RoleBadge } from '~/components/ui/role-badge';
import { SearchInput } from '~/components/ui/search-input';
import { EmptyState } from '~/components/ui/empty-state';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { DEFAULT_ATTENDANCE_POLICY, type AttendancePolicyInput } from '@yannis/shared';

export interface ExcludableStaff {
  id: string;
  name: string;
  role: string;
  branchName: string | null;
  excluded: boolean;
}

interface Props {
  policy: AttendancePolicyInput;
  staff: ExcludableStaff[];
}

/** Mon-first weekday labels; value = JS getDay() (0=Sun..6=Sat). */
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

export function AttendanceConfigPage({ policy, staff }: Props) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance rules"
        description="Set work days and strict-marking rules, and exclude staff from attendance."
        backTo="/hr/attendance"
      />

      <PolicyCard policy={policy} />
      <ExcludeStaffCard staff={staff} />
    </div>
  );
}

/** Exclude specific staff from attendance tracking (dropped from grid/reports). */
function ExcludeStaffCard({ staff }: { staff: ExcludableStaff[] }) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Staged local selection: the set of staffIds that should be EXCLUDED. Seeded
  // from the server data; one Save reconciles all changes at once.
  const [excludedIds, setExcludedIds] = useState<Set<string>>(
    () => new Set(staff.filter((s) => s.excluded).map((s) => s.id)),
  );
  useFetcherToast(fetcher.data, { successMessage: 'Exclusions saved' });
  // Keep the confirm modal open (loading) until the save resolves, then close.
  useCloseOnFetcherSuccess(fetcher, () => setConfirmOpen(false), { intent: 'setUsersExcludedBulk' });

  const term = search.trim().toLowerCase();
  const filtered = term
    ? staff.filter((s) => s.name.toLowerCase().includes(term) || (s.branchName ?? '').toLowerCase().includes(term))
    : staff;
  const excludedCount = excludedIds.size;

  // Dirty when the staged set differs from what the server has.
  const serverExcluded = new Set(staff.filter((s) => s.excluded).map((s) => s.id));
  const dirty =
    serverExcluded.size !== excludedIds.size || [...excludedIds].some((id) => !serverExcluded.has(id));

  function toggleExcluded(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Group filtered staff by branch (like the attendance page's branch sections).
  const groups = (() => {
    const map = new Map<string, { name: string; rows: ExcludableStaff[] }>();
    for (const s of filtered) {
      const key = s.branchName ?? '__none';
      const name = s.branchName ?? 'No branch';
      if (!map.has(key)) map.set(key, { name, rows: [] });
      map.get(key)!.rows.push(s);
    }
    return [...map.entries()]
      .map(([key, g]) => ({ key, name: g.name, rows: g.rows }))
      .sort((a, b) => a.name.localeCompare(b.name));
  })();

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-app-fg">Excluded staff</h3>
          <p className="text-xs text-app-fg-muted">
            Excluded staff are not tracked: they never appear in the grid, counts, report, or auto-absent.
            {excludedCount > 0 ? ` ${excludedCount} currently excluded.` : ''}
          </p>
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search staff…" className="w-full sm:w-56" />
      </div>

      {/* Save on its own action bar (same design as the grid's selection bar). */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2.5 dark:border-brand-800 dark:bg-brand-950/30">
        <span className="text-sm font-medium">{excludedCount} excluded</span>
        {dirty && <span className="text-xs text-app-fg-muted">Unsaved changes</span>}
        <fetcher.Form ref={formRef} method="post" className="ml-auto">
          <input type="hidden" name="intent" value="setUsersExcludedBulk" />
          <input type="hidden" name="scopeIds" value={staff.map((s) => s.id).join(',')} />
          <input type="hidden" name="excludedIds" value={[...excludedIds].join(',')} />
          <Button variant="primary" size="sm" type="button" onClick={() => setConfirmOpen(true)} disabled={!dirty || fetcher.state !== 'idle'}>
            {fetcher.state !== 'idle' ? 'Saving…' : 'Save exclusions'}
          </Button>
        </fetcher.Form>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No staff" description={term ? 'No staff match your search.' : 'No active staff.'} variant="card" />
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const open = !collapsed.has(g.key);
            const groupExcluded = g.rows.filter((r) => excludedIds.has(r.id)).length;
            return (
              <div key={g.key} className="overflow-hidden rounded-lg border border-app-border">
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 bg-app-muted/40 px-3 py-2 text-left"
                >
                  <svg className={`h-4 w-4 shrink-0 text-app-fg-muted transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-sm font-semibold text-app-fg">{g.name}</span>
                  <span className="text-xs text-app-fg-muted">({g.rows.length})</span>
                  {groupExcluded > 0 && (
                    <span className="ml-auto text-xs text-app-fg-muted">{groupExcluded} excluded</span>
                  )}
                </button>
                {open && (
                  <div className="divide-y divide-app-border/60">
                    {g.rows.map((s) => {
                      const checked = excludedIds.has(s.id);
                      return (
                        <label key={s.id} className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-app-muted/30">
                          <div className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleExcluded(s.id)}
                              className="h-4 w-4 shrink-0"
                            />
                            <span className={`truncate text-sm font-medium ${checked ? 'text-app-fg-muted line-through' : 'text-app-fg'}`}>{s.name}</span>
                            <RoleBadge role={s.role} size="sm" />
                          </div>
                          {checked && <span className="shrink-0 text-xs text-app-fg-muted">Excluded</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmActionModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        variant="warning"
        title="Save attendance exclusions?"
        description={`${excludedCount} staff will be excluded from attendance. Excluded staff won't appear in the grid, counts, report, or auto-absent.`}
        confirmLabel="Save exclusions"
        loading={fetcher.state !== 'idle'}
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </div>
  );
}

/** Work days + strict rules (lock previous days, auto-absent cutoff). */
function PolicyCard({ policy }: { policy: AttendancePolicyInput }) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const init = policy ?? DEFAULT_ATTENDANCE_POLICY;
  const [workDays, setWorkDays] = useState<number[]>(init.workDays);
  const [lockPreviousDays, setLockPreviousDays] = useState<boolean>(init.lockPreviousDays);
  const [autoAbsentEnabled, setAutoAbsentEnabled] = useState<boolean>(init.autoAbsentEnabled);
  const [autoAbsentCutoff, setAutoAbsentCutoff] = useState<string>(init.autoAbsentCutoff);

  useFetcherToast(fetcher.data, { successMessage: 'Attendance policy saved' });
  useCloseOnFetcherSuccess(fetcher, () => setConfirmOpen(false), { intent: 'saveAttendancePolicy' });

  function toggleDay(d: number) {
    setWorkDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  }

  const payload: AttendancePolicyInput = { workDays, lockPreviousDays, autoAbsentEnabled, autoAbsentCutoff };

  return (
    <div className="card space-y-4 p-4">
      <fetcher.Form ref={formRef} method="post" className="space-y-4">
        <input type="hidden" name="intent" value="saveAttendancePolicy" />
        <input type="hidden" name="policyJson" value={JSON.stringify(payload)} />

        {/* Work days */}
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-app-fg">Work days</h3>
          <p className="text-xs text-app-fg-muted">Days that count as work days. Other days are excluded from attendance.</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {WEEKDAYS.map((d) => {
              const active = workDays.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  aria-pressed={active}
                  className={`h-9 w-12 rounded-lg border text-sm font-medium transition ${
                    active
                      ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300'
                      : 'border-app-border text-app-fg-muted hover:bg-app-muted'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Strict rules */}
        <div className="space-y-3 border-t border-app-border pt-4">
          <h3 className="text-sm font-semibold text-app-fg">Strict rules</h3>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={lockPreviousDays}
              onChange={(e) => setLockPreviousDays(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-medium text-app-fg">Lock previous days</span>
              <span className="block text-xs text-app-fg-muted">Past days can no longer be edited once the day has ended.</span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoAbsentEnabled}
              onChange={(e) => setAutoAbsentEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-medium text-app-fg">Auto-mark absent after cutoff</span>
              <span className="block text-xs text-app-fg-muted">After the cutoff time, that day locks and anyone not marked is set Absent.</span>
            </span>
          </label>

          {autoAbsentEnabled && (
            <div className="flex items-center gap-2 pl-6">
              <span className="text-sm text-app-fg-muted">Cutoff time</span>
              <input
                type="time"
                value={autoAbsentCutoff}
                onChange={(e) => setAutoAbsentCutoff(e.target.value)}
                className="h-9 rounded-lg border border-app-border bg-app-elevated px-2 text-sm text-app-fg"
              />
            </div>
          )}
        </div>

        {fetcher.data?.error && <p className="text-sm text-red-600">{fetcher.data.error}</p>}

        <div className="flex justify-end border-t border-app-border pt-3">
          <Button variant="primary" type="button" onClick={() => setConfirmOpen(true)} disabled={fetcher.state !== 'idle' || workDays.length === 0}>
            {fetcher.state !== 'idle' ? 'Saving…' : 'Save policy'}
          </Button>
        </div>
      </fetcher.Form>

      <ConfirmActionModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        variant="warning"
        title="Save attendance policy?"
        description="This updates the work days and strict rules for everyone. Locking and auto-absent affect what can be marked and may auto-mark unmarked staff Absent after the cutoff."
        confirmLabel="Save policy"
        loading={fetcher.state !== 'idle'}
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </div>
  );
}
