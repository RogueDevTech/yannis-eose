import { useEffect, useMemo, useState } from 'react';
import { Checkbox } from '~/components/ui/checkbox';
import { Collapsible } from '~/components/ui/collapsible';
import { Modal } from '~/components/ui/modal';
import { SearchInput } from '~/components/ui/search-input';
import { formatPermissionCode, formatPermissionGroup } from '~/lib/permission-codes';
import type { PermissionCatalogItem } from './types';
import { PermissionCodeDetailPanel } from './PermissionCodeDetailPanel';

function OverviewChip({
  label,
  value,
  variant = 'default',
  title: ariaTitle,
}: {
  label: string;
  value: number;
  variant?: 'default' | 'emphasis' | 'grant' | 'revoke';
  title?: string;
}) {
  const shell =
    variant === 'emphasis'
      ? 'border-brand-500/45 bg-brand-500/[0.12] dark:bg-brand-500/15'
      : variant === 'grant'
        ? 'border-success-500/35 bg-success-500/10 dark:bg-success-500/15'
        : variant === 'revoke'
          ? 'border-danger-500/35 bg-danger-500/10 dark:bg-danger-500/15'
          : 'border-app-border bg-app-hover/60 dark:bg-app-hover/40';

  const valueClass =
    variant === 'emphasis'
      ? 'text-base font-semibold tabular-nums text-app-fg'
      : 'text-sm font-semibold tabular-nums text-app-fg';

  return (
    <span
      title={ariaTitle}
      className={`inline-flex flex-col gap-0 rounded-lg border px-2 py-1 sm:flex-row sm:items-baseline sm:gap-1.5 ${shell}`}
    >
      <span className="text-micro uppercase tracking-wide text-app-fg-muted font-medium leading-none">{label}</span>
      <span className={valueClass}>{value}</span>
    </span>
  );
}

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

interface PermissionMatrixProps {
  permissions: PermissionCatalogItem[];
  templateCodes: string[];
  overrides: Record<string, boolean>;
  onOverridesChange: (next: Record<string, boolean>) => void;
  /**
   * When true the matrix renders as a preview only — checkboxes are disabled, the
   * select-all + reset controls are hidden. The "Edit permissions" CTA on the
   * profile page flips this off so the same matrix becomes editable with the
   * current grants pre-loaded.
   */
  readOnly?: boolean;
  /** Human label for the role driving the template baseline (e.g. “Head of Marketing”). */
  selectedRoleLabel?: string;
}

export function PermissionMatrix({
  permissions,
  templateCodes,
  overrides,
  onOverridesChange,
  readOnly = false,
  selectedRoleLabel,
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
      [
        perm.code,
        formatPermissionCode(perm.code), // search also matches the human label
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

  /** Rows in the catalog that are effectively ON for this user (template ∪ overrides). */
  const effectiveGrantedCount = useMemo(() => {
    let n = 0;
    for (const perm of permissions) {
      const inherited = templateSet.has(perm.code);
      const o = overrides[perm.code];
      if ((o ?? inherited) === true) n += 1;
    }
    return n;
  }, [permissions, overrides, templateSet]);

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
    <div className="space-y-4">
      <Collapsible
        defaultOpen={false}
        className="overflow-hidden rounded-xl border border-app-border bg-gradient-to-b from-app-hover/50 to-app-hover/25 dark:from-app-hover/30 dark:to-transparent shadow-sm transition-colors hover:border-brand-500/45 hover:shadow-md hover:from-app-hover dark:hover:border-brand-400/35 focus-within:ring-2 focus-within:ring-brand-500/50 focus-within:ring-offset-2 focus-within:ring-offset-app-canvas"
        triggerClassName="!items-start cursor-pointer px-3 py-3 sm:px-4 sm:py-3.5 gap-3 outline-none"
        contentClassName="space-y-4 px-3 pb-4 sm:px-4 pt-4 border-t border-app-border"
        trigger={
          <div className="min-w-0 flex-1 text-left">
            <span className="sr-only">Expand or collapse the permission matrix.</span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-base font-semibold text-app-fg">Permissions</h2>
              <span className="inline-flex items-center rounded-full border border-brand-500/40 bg-brand-500/15 px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                Click or tap to expand
              </span>
            </div>
            <p className="text-xs text-app-fg-muted mt-2 leading-relaxed">
              <span className="text-app-fg font-medium">Click this panel</span> to open search and per-permission
              toggles. Summary counts update from the role baseline and any edits you make.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-app-fg-muted">Selected role</span>
              <span className="rounded-md bg-app-hover px-2 py-0.5 font-medium text-app-fg ring-1 ring-app-border">
                {selectedRoleLabel ?? '—'}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <OverviewChip
                label="Role baseline"
                value={templateCodes.length}
                title="Permission codes on the SYSTEM template for this role (shown checked when there is no override)."
              />
              <OverviewChip
                label="In catalog"
                value={permissions.length}
                title="Total rows in the permission catalog (what you can toggle in the matrix)."
              />
              <OverviewChip
                label="Granted now"
                value={effectiveGrantedCount}
                variant="emphasis"
                title="Catalog rows that are ON for this user (inherit template unless overridden)."
              />
              <OverviewChip label="+ Extra grants" value={totals.explicitGrant} variant="grant" title="Explicit grants beyond the role baseline." />
              <OverviewChip label="− Revokes" value={totals.explicitRevoke} variant="revoke" title="Explicit revokes that turn off an inherited permission." />
            </div>
            <p className="mt-2 text-mini text-app-fg-muted">
              Inherited checks from template (unchanged):{' '}
              <span className="tabular-nums font-medium text-app-fg">{totals.inherited}</span>
              <span className="mx-1.5 text-app-border">·</span>
              Effective total{' '}
              <span className="tabular-nums font-semibold text-app-fg">
                {effectiveGrantedCount}/{permissions.length}
              </span>{' '}
              in catalog
            </p>
          </div>
        }
      >
        <p className="text-xs text-app-fg-muted">
          Checks come from the role you picked. Toggle to add or remove individual permissions for this user.
        </p>

        <form onSubmit={(e) => e.preventDefault()}>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search permissions (code, resource, action)..."
            debounceMs={120}
            withSubmitButton
          />
        </form>

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
                                  disabled={readOnly}
                                  onChange={(e) => {
                                    if (readOnly) return;
                                    setGroupEffective(rows, (e.target as HTMLInputElement).checked);
                                  }}
                                />
                              </label>
                              <div className="min-w-0">
                                <p className="text-mini uppercase tracking-wide text-app-fg-muted font-semibold">
                                  {formatPermissionGroup(groupKey)}
                                </p>
                                <p className="text-xs text-app-fg-muted">
                                  {effectiveCount}/{rows.length} granted
                                  {inheritedCount > 0 && (
                                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-micro font-medium bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                                      {inheritedCount} from role
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                            <div className="shrink-0">
                              <span className="text-mini rounded px-2 py-0.5 border border-app-border text-app-fg-muted">
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
                                    disabled={readOnly}
                                    onChange={(e) => {
                                      if (readOnly) return;
                                      setOverride(perm.code, (e.target as HTMLInputElement).checked);
                                    }}
                                  />
                                  <span className="min-w-0">
                                    {/* Friendly label drives readability; the
                                        canonical dotted code stays visible
                                        underneath as the source-of-truth
                                        identifier (audit trail, debugging,
                                        grepping the codebase). */}
                                    <span className="block text-sm font-medium text-app-fg">
                                      {formatPermissionCode(perm.code)}
                                    </span>
                                    <span className="block font-mono text-mini text-app-fg-muted mt-0.5 break-all">
                                      {perm.code}
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
                                  <span className="text-mini rounded px-2 py-0.5 border border-app-border text-app-fg-muted">
                                    {stateLabel}
                                  </span>
                                  {override !== undefined && !readOnly ? (
                                    <button
                                      type="button"
                                      className="text-mini text-brand-500 hover:text-brand-600"
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
      </Collapsible>

      <Modal
        open={infoPermission !== null}
        onClose={() => setInfoPermission(null)}
        maxWidth="max-w-lg"
        aria-labelledby="permission-info-title"
        contentClassName="p-6 space-y-4"
      >
        {infoPermission ? (
          <PermissionCodeDetailPanel
            code={infoPermission.code}
            description={infoPermission.description}
            legacyAliases={infoPermission.legacyAliases}
            onClose={() => setInfoPermission(null)}
            titleId="permission-info-title"
          />
        ) : null}
      </Modal>
    </div>
  );
}
