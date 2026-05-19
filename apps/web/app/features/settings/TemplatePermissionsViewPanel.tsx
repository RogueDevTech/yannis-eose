import { useEffect, useMemo, useState } from 'react';
import { Collapsible } from '~/components/ui/collapsible';
import { SearchInput } from '~/components/ui/search-input';
import { formatPermissionCode, formatPermissionGroup } from '~/lib/permission-codes';
import type { PermissionPickRow } from '~/features/settings/PermissionCheckboxPicker';

interface TemplatePermissionsViewPanelProps {
  catalog: PermissionPickRow[];
  grantedCodes: ReadonlySet<string>;
}

function buildGrantedRows(catalog: PermissionPickRow[], grantedCodes: ReadonlySet<string>): PermissionPickRow[] {
  const byCode = new Map(catalog.map((p) => [p.code, p]));
  const rows: PermissionPickRow[] = [];
  for (const code of grantedCodes) {
    const row = byCode.get(code);
    if (row) rows.push(row);
    else
      rows.push({
        code,
        resource: '',
        action: '',
        description: null,
      });
  }
  rows.sort((a, b) => a.code.localeCompare(b.code));
  return rows;
}

export function TemplatePermissionsViewPanel({ catalog, grantedCodes }: TemplatePermissionsViewPanelProps) {
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const catalogCodeSet = useMemo(() => new Set(catalog.map((c) => c.code)), [catalog]);
  const grantedRows = useMemo(() => buildGrantedRows(catalog, grantedCodes), [catalog, grantedCodes]);
  const grantedCount = grantedRows.length;

  useEffect(() => {
    if (grantedRows.length === 0) return;
    const keys = new Set<string>();
    for (const p of grantedRows) {
      const k = p.code.split('.')[0];
      if (k) keys.add(k);
    }
    setOpenGroups(keys);
  }, [grantedRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return grantedRows;
    return grantedRows.filter((perm) =>
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
  }, [grantedRows, query]);

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

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => e.preventDefault()}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search granted permissions…"
          debounceMs={120}
          withSubmitButton
        />
      </form>
      <div className="rounded-lg border border-app-border divide-y divide-app-border max-h-[min(50vh,22rem)] overflow-y-auto">
        {grantedCount === 0 ? (
          <div className="p-4 text-sm text-app-fg-muted">This template has no permissions assigned.</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="p-4 text-sm text-app-fg-muted">No granted permissions match your search.</div>
        ) : (
          Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([groupKey, rows]) => (
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
                      <div className="min-w-0">
                        <p className="text-mini uppercase tracking-wide text-app-fg-muted font-semibold">
                          {formatPermissionGroup(groupKey)}
                        </p>
                        <p className="text-xs text-app-fg-muted">{rows.length} permission{rows.length === 1 ? '' : 's'}</p>
                      </div>
                    </div>
                  }
                  contentClassName="pt-2 space-y-1"
                >
                  {rows.map((perm) => {
                    const orphan = !catalogCodeSet.has(perm.code);
                    return (
                      <div
                        key={perm.code}
                        className="rounded-md border border-app-border px-2.5 py-2"
                        title={perm.description ?? undefined}
                      >
                        <div className="min-w-0">
                          <span className="block text-sm font-medium text-app-fg">{formatPermissionCode(perm.code)}</span>
                          <span className="block font-mono text-mini text-app-fg-muted mt-0.5 break-all">{perm.code}</span>
                          {orphan ? (
                            <span className="mt-1 block text-mini text-warning-600 dark:text-warning-400">
                              Not in current catalog (still granted on template)
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </Collapsible>
              </div>
            ))
        )}
      </div>
      <p className="text-xs text-app-fg-muted">
        <span className="font-medium text-app-fg">{grantedCount}</span> permission{grantedCount === 1 ? '' : 's'} on this
        template
      </p>
    </div>
  );
}
