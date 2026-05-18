import { useEffect, useMemo, useState } from 'react';
import { Checkbox } from '~/components/ui/checkbox';
import { Collapsible } from '~/components/ui/collapsible';
import { Modal } from '~/components/ui/modal';
import { SearchInput } from '~/components/ui/search-input';
import { PermissionCodeDetailPanel } from '~/features/users/PermissionCodeDetailPanel';
import { formatPermissionCode, formatPermissionGroup } from '~/lib/permission-codes';

function PermissionInfoIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
      />
    </svg>
  );
}

export interface PermissionPickRow {
  code: string;
  resource: string;
  action: string;
  description: string | null;
  legacyAliases?: string[];
}

interface PermissionCheckboxPickerProps {
  permissions: PermissionPickRow[];
  selectedCodes: Set<string>;
  onToggle: (code: string, checked: boolean) => void;
  /** Optional summary line above the list */
  summary?: string;
  emptyMessage?: string;
  /** Expand every group when the catalog loads (good for template modals). */
  initialExpandAll?: boolean;
}

export function PermissionCheckboxPicker({
  permissions,
  selectedCodes,
  onToggle,
  summary,
  emptyMessage = 'No permissions in catalog.',
  initialExpandAll = true,
}: PermissionCheckboxPickerProps) {
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [detailPermission, setDetailPermission] = useState<PermissionPickRow | null>(null);

  useEffect(() => {
    if (!initialExpandAll || permissions.length === 0) return;
    const keys = new Set<string>();
    for (const p of permissions) {
      const k = p.code.split('.')[0];
      if (k) keys.add(k);
    }
    setOpenGroups(keys);
  }, [initialExpandAll, permissions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return permissions;
    return permissions.filter((perm) =>
      [
        perm.code,
        formatPermissionCode(perm.code),
        perm.resource,
        perm.action,
        perm.description ?? '',
        ...(perm.legacyAliases ?? []),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [permissions, query]);

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, PermissionPickRow[]>>((acc, perm) => {
      const key = perm.code.split('.')[0] ?? 'other';
      acc[key] ??= [];
      acc[key].push(perm);
      return acc;
    }, {});
  }, [filtered]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    setOpenGroups(new Set(Object.keys(grouped)));
  }, [grouped, query]);

  const selectedCount = useMemo(() => permissions.filter((p) => selectedCodes.has(p.code)).length, [permissions, selectedCodes]);

  return (
    <div className="space-y-3">
      {summary ? <p className="text-xs text-app-fg-muted">{summary}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search permissions (code, resource, action)..."
          debounceMs={120}
          withSubmitButton
        />
      </form>
      <div className="rounded-lg border border-app-border divide-y divide-app-border max-h-[min(50vh,22rem)] overflow-y-auto">
        {permissions.length === 0 ? (
          <div className="p-4 text-sm text-app-fg-muted">{emptyMessage}</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="p-4 text-sm text-app-fg-muted">No permissions match your search.</div>
        ) : (
          Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([groupKey, rows]) => {
              const effectiveCount = rows.reduce((sum, perm) => sum + (selectedCodes.has(perm.code) ? 1 : 0), 0);
              const allSelected = effectiveCount === rows.length && rows.length > 0;
              const noneSelected = effectiveCount === 0;
              const mixed = !allSelected && !noneSelected;
              return (
                <div key={groupKey} className="p-3">
                  <Collapsible
                    open={openGroups.has(groupKey)}
                    onOpenChange={(open) => {
                      setOpenGroups((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(groupKey);
                        else next.delete(groupKey);
                        return next;
                      });
                    }}
                    trigger={
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <label className="flex items-center gap-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={allSelected}
                              onChange={(e) => {
                                const on = (e.target as HTMLInputElement).checked;
                                for (const perm of rows) onToggle(perm.code, on);
                              }}
                            />
                          </label>
                          <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-wide text-app-fg-muted font-semibold">
                              {formatPermissionGroup(groupKey)}
                            </p>
                            <p className="text-xs text-app-fg-muted">
                              {effectiveCount}/{rows.length} selected
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] rounded px-2 py-0.5 border border-app-border text-app-fg-muted">
                          {mixed ? 'Mixed' : allSelected ? 'All' : 'None'}
                        </span>
                      </div>
                    }
                    contentClassName="pt-2 space-y-1"
                  >
                    {rows.map((perm) => (
                      <div
                        key={perm.code}
                        className="rounded-md border border-app-border px-2.5 py-2"
                        title={perm.description ?? undefined}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <label className="flex items-start gap-2 cursor-pointer min-w-0 flex-1">
                            <Checkbox
                              checked={selectedCodes.has(perm.code)}
                              onChange={(e) => onToggle(perm.code, (e.target as HTMLInputElement).checked)}
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-app-fg">{formatPermissionCode(perm.code)}</span>
                              <span className="block font-mono text-[11px] text-app-fg-muted mt-0.5 break-all">{perm.code}</span>
                            </span>
                          </label>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-app-fg-muted hover:bg-app-hover hover:text-app-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                            aria-label={`What is ${perm.code}?`}
                            onClick={() => setDetailPermission(perm)}
                          >
                            <PermissionInfoIcon className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </Collapsible>
                </div>
              );
            })
        )}
      </div>
      <p className="text-xs text-app-fg-muted">
        <span className="font-medium text-app-fg">{selectedCount}</span> of {permissions.length} permissions selected
      </p>

      <Modal
        open={detailPermission !== null}
        onClose={() => setDetailPermission(null)}
        maxWidth="max-w-lg"
        aria-labelledby="permission-picker-detail-title"
        contentClassName="p-6 space-y-4"
      >
        {detailPermission ? (
          <PermissionCodeDetailPanel
            code={detailPermission.code}
            description={detailPermission.description}
            legacyAliases={detailPermission.legacyAliases}
            onClose={() => setDetailPermission(null)}
            titleId="permission-picker-detail-title"
          />
        ) : null}
      </Modal>
    </div>
  );
}
