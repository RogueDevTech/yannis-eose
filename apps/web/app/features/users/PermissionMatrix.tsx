import { useEffect, useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { Collapsible } from '~/components/ui/collapsible';
import { DescriptionList } from '~/components/ui/description-list';
import { Modal } from '~/components/ui/modal';
import { SearchInput } from '~/components/ui/search-input';

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

export interface PermissionCatalogItem {
  code: string;
  resource: string;
  action: string;
  description: string | null;
}

interface PermissionMatrixProps {
  permissions: PermissionCatalogItem[];
  templateCodes: string[];
  overrides: Record<string, boolean>;
  onOverridesChange: (next: Record<string, boolean>) => void;
}

export function PermissionMatrix({
  permissions,
  templateCodes,
  overrides,
  onOverridesChange,
}: PermissionMatrixProps) {
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [infoPermission, setInfoPermission] = useState<PermissionCatalogItem | null>(null);
  const templateSet = useMemo(() => new Set(templateCodes), [templateCodes]);

  // When the role's template changes (e.g. user just picked "Media Buyer"),
  // auto-expand every group that has at least one inherited permission so the
  // pre-checked rows are immediately visible. Without this, groups stay
  // collapsed and the user thinks nothing pre-filled.
  useEffect(() => {
    if (templateCodes.length === 0) return;
    const groupsWithInherited = new Set<string>();
    for (const code of templateCodes) {
      const groupKey = code.split('.')[0];
      if (groupKey) groupsWithInherited.add(groupKey);
    }
    setOpenGroups((prev) => {
      // Union with whatever the user has already opened — never collapse on
      // them, only auto-open the inherited ones.
      const next = new Set(prev);
      for (const key of groupsWithInherited) next.add(key);
      return next;
    });
    // Rerun only when the template's code list changes — keyed on size + a
    // stable join so swapping roles refreshes the auto-open set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateCodes.length, templateCodes.join('|')]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return permissions;
    return permissions.filter((perm) =>
      [perm.code, perm.resource, perm.action, perm.description ?? ''].join(' ').toLowerCase().includes(q),
    );
  }, [permissions, query]);

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, PermissionCatalogItem[]>>((acc, perm) => {
      const key = perm.code.split('.')[0] ?? 'other';
      acc[key] ??= [];
      acc[key].push(perm);
      return acc;
    }, {});
  }, [filtered]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const keys = Object.keys(grouped);
    setOpenGroups(new Set(keys));
  }, [grouped, query]);

  const totals = useMemo(() => {
    let inherited = 0;
    let explicitGrant = 0;
    let explicitRevoke = 0;
    for (const perm of permissions) {
      const override = overrides[perm.code];
      if (override === true) explicitGrant++;
      else if (override === false) explicitRevoke++;
      else if (templateSet.has(perm.code)) inherited++;
    }
    return { inherited, explicitGrant, explicitRevoke };
  }, [overrides, permissions, templateSet]);

  const setOverride = (code: string, nextChecked: boolean) => {
    const inherited = templateSet.has(code);
    const next = { ...overrides };
    if (nextChecked === inherited) delete next[code];
    else next[code] = nextChecked;
    onOverridesChange(next);
  };

  const setGroupEffective = (rows: PermissionCatalogItem[], nextChecked: boolean) => {
    const next = { ...overrides };
    for (const perm of rows) {
      const inherited = templateSet.has(perm.code);
      if (nextChecked === inherited) {
        delete next[perm.code];
      } else {
        next[perm.code] = nextChecked;
      }
    }
    onOverridesChange(next);
  };

  const resetCode = (code: string) => {
    if (!(code in overrides)) return;
    const next = { ...overrides };
    delete next[code];
    onOverridesChange(next);
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-app-fg">Permissions</h2>
          <p className="text-xs text-app-fg-muted mt-1">
            Checks come from the role you picked. Toggle to add or remove individual permissions for this user.
          </p>
        </div>
        <div className="text-xs text-app-fg-muted text-right">
          <div>Inherited: {totals.inherited}</div>
          <div>Explicit grants: {totals.explicitGrant}</div>
          <div>Explicit revokes: {totals.explicitRevoke}</div>
        </div>
      </div>

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search permissions (code, resource, action)..."
        debounceMs={120}
      />

      <div className="rounded-lg border border-app-border divide-y divide-app-border">
        {Object.keys(grouped).length === 0 ? (
          <div className="p-4 text-sm text-app-fg-muted">No permissions match your search.</div>
        ) : (
          Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([groupKey, rows]) => (
              <div key={groupKey} className="p-3">
                {(() => {
                  const effectiveCount = rows.reduce((sum, perm) => {
                    const inherited = templateSet.has(perm.code);
                    const override = overrides[perm.code];
                    return sum + ((override ?? inherited) ? 1 : 0);
                  }, 0);
                  const inheritedCount = rows.reduce(
                    (sum, perm) => sum + (templateSet.has(perm.code) ? 1 : 0),
                    0,
                  );
                  const allGranted = effectiveCount === rows.length && rows.length > 0;
                  const allRevoked = effectiveCount === 0;
                  const mixed = !allGranted && !allRevoked;
                  return (
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
                            <label
                              className="flex items-center gap-2 cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Checkbox
                                checked={allGranted}
                                onChange={(e) => {
                                  setGroupEffective(rows, (e.target as HTMLInputElement).checked);
                                }}
                              />
                            </label>
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-wide text-app-fg-muted font-semibold">
                                {groupKey}
                              </p>
                              <p className="text-xs text-app-fg-muted">
                                {effectiveCount}/{rows.length} granted
                                {inheritedCount > 0 && (
                                  <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                                    {inheritedCount} from role
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="shrink-0">
                            <span className="text-[11px] rounded px-2 py-0.5 border border-app-border text-app-fg-muted">
                              {mixed ? 'Mixed' : allGranted ? 'All granted' : 'All revoked'}
                            </span>
                          </div>
                        </div>
                      }
                      contentClassName="pt-2 space-y-1"
                    >
                      {rows.map((perm) => {
                        const inherited = templateSet.has(perm.code);
                        const override = overrides[perm.code];
                        const effective = override ?? inherited;
                        const stateLabel =
                          override === true ? 'Explicit grant' : override === false ? 'Explicit revoke' : inherited ? 'Inherited' : 'Not granted';
                        return (
                          <div key={perm.code} className="rounded-md border border-app-border px-2.5 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <label className="flex items-start gap-2 cursor-pointer min-w-0 flex-1">
                                <Checkbox
                                  checked={effective}
                                  onChange={(e) => setOverride(perm.code, (e.target as HTMLInputElement).checked)}
                                />
                                <span className="min-w-0">
                                  <span className="block text-sm font-medium text-app-fg break-all">{perm.code}</span>
                                  <span className="block text-[11px] text-app-fg-muted mt-0.5">
                                    {perm.resource} · {perm.action}
                                  </span>
                                </span>
                              </label>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-app-fg-muted hover:bg-app-hover hover:text-app-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                                  aria-label={`What is ${perm.code}?`}
                                  onClick={() => setInfoPermission(perm)}
                                >
                                  <PermissionInfoIcon className="h-5 w-5" />
                                </button>
                                <span className="text-[11px] rounded px-2 py-0.5 border border-app-border text-app-fg-muted">
                                  {stateLabel}
                                </span>
                                {override !== undefined ? (
                                  <button
                                    type="button"
                                    className="text-[11px] text-brand-500 hover:text-brand-600"
                                    onClick={() => resetCode(perm.code)}
                                  >
                                    Reset
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </Collapsible>
                  );
                })()}
              </div>
            ))
        )}
      </div>

      <Modal
        open={infoPermission !== null}
        onClose={() => setInfoPermission(null)}
        maxWidth="max-w-lg"
        aria-labelledby="permission-info-title"
        contentClassName="p-6 space-y-4"
      >
        {infoPermission ? (
          <>
            <h2 id="permission-info-title" className="text-lg font-semibold text-app-fg break-all">
              {infoPermission.code}
            </h2>
            <DescriptionList
              layout="stacked"
              divided
              items={[
                { label: 'Resource', value: infoPermission.resource },
                { label: 'Action', value: infoPermission.action },
                {
                  label: 'What it allows',
                  value: infoPermission.description ? (
                    <span className="text-sm text-app-fg whitespace-pre-wrap">{infoPermission.description}</span>
                  ) : (
                    <span className="text-sm text-app-fg-muted italic">
                      No catalog description yet. Ask a Super Admin to extend the permission seed metadata if this
                      needs documentation.
                    </span>
                  ),
                  fullWidth: true,
                },
              ]}
            />
            <div className="flex justify-end pt-1">
              <Button type="button" variant="secondary" onClick={() => setInfoPermission(null)}>
                Close
              </Button>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
