import { useMemo } from 'react';
import { canonicalPermissionCode, formatPermissionCode, formatPermissionGroup } from '~/lib/permission-codes';
import type { PermissionCatalogItem } from './types';

function resolveOverrideForCatalogPerm(
  perm: PermissionCatalogItem,
  overrides: Record<string, boolean>,
): boolean | undefined {
  const direct = overrides[perm.code];
  if (direct !== undefined) return direct;
  for (const alias of perm.legacyAliases ?? []) {
    const v = overrides[alias];
    if (v !== undefined) return v;
  }
  return undefined;
}

function catalogCoversOverrideKey(permissions: PermissionCatalogItem[], key: string): boolean {
  for (const perm of permissions) {
    if (perm.code === key) return true;
    if (perm.legacyAliases?.includes(key)) return true;
  }
  return false;
}

interface PermissionsPreviewProps {
  /** Full permission catalog — used to group + label every code when loaded. */
  permissions: PermissionCatalogItem[];
  /** Codes inherited from the user's role template (baseline). */
  templateCodes: string[];
  /**
   * Per-user overrides: `true` = explicit grant on top of the template,
   * `false` = explicit revoke (still rendered, faded + struck through).
   */
  overrides: Record<string, boolean>;
  /**
   * Canonical codes from RBAC union (template ∪ `role_permissions` ∪ stamped grants − revokes).
   * Primary source for which chips are granted when the catalog row would otherwise look absent.
   */
  effectiveCodes: string[];
  /** True when `permissions.listCatalog` failed — distinct from an empty DB catalog. */
  catalogRequestFailed?: boolean;
}

/**
 * Compact, read-only summary of every permission a user effectively holds.
 * Built for the user-detail page Overview tab — designed to be scannable, NOT
 * to look like the editable matrix on the Settings tab.
 */
export function PermissionsPreview({
  permissions,
  templateCodes,
  overrides,
  effectiveCodes,
  catalogRequestFailed = false,
}: PermissionsPreviewProps) {
  const inheritedSet = useMemo(() => new Set(templateCodes.map((c) => canonicalPermissionCode(c))), [templateCodes]);
  const effectiveUnionSet = useMemo(
    () => new Set(effectiveCodes.map((c) => canonicalPermissionCode(c))),
    [effectiveCodes],
  );

  const items = useMemo(() => {
    type Row = {
      perm: PermissionCatalogItem;
      effective: boolean;
      state: 'inherited' | 'explicitGrant' | 'explicitRevoke' | 'absent';
      inherited: boolean;
    };

    const fromCatalog: Row[] = permissions.map((perm) => {
      const code = canonicalPermissionCode(perm.code);
      const inherited = inheritedSet.has(code);
      const override = resolveOverrideForCatalogPerm(perm, overrides);
      const inUnion = effectiveUnionSet.has(code);

      let state: Row['state'];
      if (override === false) state = 'explicitRevoke';
      else if (!inUnion) state = 'absent';
      else if (override === true || !inherited) state = 'explicitGrant';
      else state = 'inherited';

      return { perm, effective: inUnion, state, inherited };
    });

    const orphanRows: Row[] = [];
    for (const [code, overrideVal] of Object.entries(overrides)) {
      if (catalogCoversOverrideKey(permissions, code)) continue;
      const canon = canonicalPermissionCode(code);
      const inherited = inheritedSet.has(canon);
      const inUnion = effectiveUnionSet.has(canon);
      const override = overrideVal;

      let state: Row['state'];
      if (override === false) state = 'explicitRevoke';
      else if (!inUnion) state = 'absent';
      else if (override === true || !inherited) state = 'explicitGrant';
      else state = 'inherited';

      orphanRows.push({
        perm: {
          code,
          resource: '',
          action: '',
          description:
            'Stamped on this user; no matching row in the live catalog (legacy or retired code).',
        },
        effective: inUnion,
        state,
        inherited,
      });
    }

    return [...fromCatalog, ...orphanRows].filter(
      (row) => row.effective || row.state === 'explicitRevoke',
    );
  }, [permissions, inheritedSet, overrides, effectiveUnionSet]);

  const grouped = useMemo(() => {
    const map: Record<string, typeof items> = {};
    for (const row of items) {
      const key = row.perm.code.split('.')[0] ?? 'other';
      (map[key] ??= []).push(row);
    }
    return Object.entries(map).sort(([a], [b]) =>
      formatPermissionGroup(a).localeCompare(formatPermissionGroup(b)),
    );
  }, [items]);

  const totals = useMemo(() => {
    let inherited = 0;
    let explicitGrant = 0;
    let explicitRevoke = 0;
    for (const row of items) {
      if (row.state === 'inherited') inherited += 1;
      else if (row.state === 'explicitGrant') explicitGrant += 1;
      else if (row.state === 'explicitRevoke') explicitRevoke += 1;
    }
    return { inherited, explicitGrant, explicitRevoke, granted: inherited + explicitGrant };
  }, [items]);

  /** Catalog rows loaded but none intersect the RBAC union (or catalog empty) — still show effective codes. */
  const useEffectiveOnlyFallback =
    effectiveCodes.length > 0 &&
    totals.granted === 0 &&
    totals.explicitRevoke === 0;

  const fallbackGrouped = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const code of effectiveCodes) {
      const canon = canonicalPermissionCode(code);
      const key = canon.split('.')[0] ?? 'other';
      const bucket = map[key] ?? [];
      if (!bucket.includes(canon)) bucket.push(canon);
      map[key] = bucket;
    }
    for (const k of Object.keys(map)) {
      map[k]!.sort((a, b) => a.localeCompare(b));
    }
    return Object.entries(map).sort(([a], [b]) =>
      formatPermissionGroup(a).localeCompare(formatPermissionGroup(b)),
    );
  }, [effectiveCodes]);

  const orphanRevokesOnly = useMemo(() => {
    const rows: { code: string }[] = [];
    for (const [code, v] of Object.entries(overrides)) {
      if (v !== false) continue;
      const canon = canonicalPermissionCode(code);
      if (!effectiveUnionSet.has(canon)) rows.push({ code: canon });
    }
    return rows;
  }, [overrides, effectiveUnionSet]);

  if (permissions.length === 0 || useEffectiveOnlyFallback) {
    if (effectiveCodes.length === 0 && orphanRevokesOnly.length === 0) {
      return (
        <p className="text-sm text-app-fg-muted">
          {catalogRequestFailed
            ? 'Permission catalog did not load and no effective codes were returned. Check your connection, run permission seeds, then retry.'
            : 'No permissions assigned. Use the Settings tab to grant access.'}
        </p>
      );
    }

    return (
      <div className="space-y-3">
        {catalogRequestFailed ? (
          <p className="text-xs text-amber-700 dark:text-amber-400/90">
            Permission catalog unavailable — showing effective capability codes only (labels may be missing).
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-app-fg-muted">
          <span>
            <strong className="text-app-fg">{effectiveCodes.length}</strong> granted
          </span>
          {orphanRevokesOnly.length > 0 ? (
            <>
              <span className="text-app-border">·</span>
              <span>
                <span className="font-medium text-danger-600 dark:text-danger-400">
                  {orphanRevokesOnly.length}
                </span>{' '}
                revoked
              </span>
            </>
          ) : null}
        </div>
        <div className="space-y-3">
          {fallbackGrouped.map(([groupKey, codes]) => (
            <div
              key={groupKey}
              className="flex flex-col gap-1.5 border-b border-app-border/50 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4"
            >
              <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-app-fg-muted sm:min-w-[9.5rem]">
                {formatPermissionGroup(groupKey)}{' '}
                <span className="text-app-fg-muted/70">({codes.length})</span>
              </p>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {codes.map((code) => (
                  <span
                    key={code}
                    title={code}
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[12px] font-medium bg-app-hover text-app-fg ring-1 ring-app-border"
                  >
                    {formatPermissionCode(code)}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {orphanRevokesOnly.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t border-app-border/50 pt-3 sm:flex-row sm:items-baseline sm:gap-4">
              <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-app-fg-muted sm:min-w-[9.5rem]">
                Revoked <span className="text-app-fg-muted/70">({orphanRevokesOnly.length})</span>
              </p>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {orphanRevokesOnly.map(({ code }) => (
                  <span
                    key={code}
                    title={`${code} — explicitly revoked`}
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[12px] font-medium text-danger-600 dark:text-danger-400 line-through ring-1 ring-danger-500/20"
                  >
                    {formatPermissionCode(code)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (totals.granted === 0 && totals.explicitRevoke === 0) {
    return (
      <p className="text-sm text-app-fg-muted">
        No permissions assigned. Use the Settings tab to grant access.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Stat strip — one chip per metric, color-keyed. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-app-hover px-2.5 py-1 text-xs ring-1 ring-app-border">
          <span className="font-semibold text-app-fg tabular-nums">{totals.granted}</span>
          <span className="text-app-fg-muted">granted</span>
        </span>
        {totals.inherited > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-app-hover/40 px-2.5 py-1 text-xs ring-1 ring-app-border/60">
            <span className="font-semibold text-app-fg-muted tabular-nums">{totals.inherited}</span>
            <span className="text-app-fg-muted">from template</span>
          </span>
        )}
        {totals.explicitGrant > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2.5 py-1 text-xs ring-1 ring-brand-500/30 dark:bg-brand-900/30">
            <span className="font-semibold text-brand-700 dark:text-brand-300 tabular-nums">+{totals.explicitGrant}</span>
            <span className="text-brand-600 dark:text-brand-400">extra</span>
          </span>
        )}
        {totals.explicitRevoke > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-danger-50 px-2.5 py-1 text-xs ring-1 ring-danger-500/30 dark:bg-danger-900/30">
            <span className="font-semibold text-danger-700 dark:text-danger-300 tabular-nums">−{totals.explicitRevoke}</span>
            <span className="text-danger-600 dark:text-danger-400">revoked</span>
          </span>
        )}
      </div>

      {/* One row per domain: label (fixed column) + chips flowing horizontally */}
      <div className="space-y-3">
        {grouped.map(([groupKey, rows]) => {
          const grantedRows = rows.filter((r) => r.effective);
          const revokedRows = rows.filter((r) => r.state === 'explicitRevoke');
          if (grantedRows.length === 0 && revokedRows.length === 0) return null;
          return (
            <div
              key={groupKey}
              className="flex flex-col gap-1.5 border-b border-app-border/50 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4"
            >
              <div className="flex shrink-0 items-baseline gap-2 sm:min-w-[10rem]">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-app-fg-muted">
                  {formatPermissionGroup(groupKey)}
                </h3>
                <span className="text-[11px] text-app-fg-muted tabular-nums">
                  {grantedRows.length}
                  {revokedRows.length > 0 ? (
                    <span className="ml-1 text-danger-600 dark:text-danger-400">−{revokedRows.length}</span>
                  ) : null}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {grantedRows.map(({ perm, state }) => {
                  const detail = stripGroupPrefix(perm.code);
                  return (
                    <span
                      key={perm.code}
                      title={`${perm.code}${perm.description ? ` — ${perm.description}` : ''}`}
                      className={
                        state === 'explicitGrant'
                          ? 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-brand-50 text-brand-700 ring-1 ring-brand-500/30 dark:bg-brand-900/30 dark:text-brand-200'
                          : 'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-app-hover/70 text-app-fg-muted ring-1 ring-app-border/60 transition-colors hover:text-app-fg hover:ring-app-border'
                      }
                    >
                      {state === 'explicitGrant' && (
                        <span className="text-brand-500" aria-hidden>+</span>
                      )}
                      {detail}
                    </span>
                  );
                })}
                {revokedRows.map(({ perm }) => (
                  <span
                    key={perm.code}
                    title={`${perm.code} — explicitly revoked from this user`}
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium text-danger-600 dark:text-danger-400 line-through ring-1 ring-danger-500/30"
                  >
                    {stripGroupPrefix(perm.code)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Format a permission code's "detail" — i.e. drop the leading domain segment
 * (which is already the group card's header). Examples:
 *   "audit.logs.view"               → "Logs view"
 *   "marketing.ad_spend.approve"    → "Ad spend approve"
 *   "users.staff.update.supervised" → "Staff update supervised"
 *
 * Falls back to the full formatted code when the input has no dot.
 */
function stripGroupPrefix(code: string): string {
  const dot = code.indexOf('.');
  if (dot === -1) return formatPermissionCode(code);
  return formatPermissionCode(code.slice(dot + 1));
}
