import { json } from '@remix-run/node';
import type { CsRoutingRelationshipMode } from '@yannis/shared';
import type { CsRoutingRuleRow } from '~/features/settings/CsOrderRoutingSettingsPage';
import { apiRequest, getSessionCookie, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';

/** Minimal viewer shape for branch scope (matches session user fields used here). */
export type CsOrderRoutingViewer = {
  role: string;
  currentBranchId?: string | null;
};

export interface CsOrderRoutingLoaderData {
  branches: Array<{ id: string; name: string; code?: string | null }>;
  products: Array<{ id: string; name: string }>;
  teamsByBranchId: Record<string, { id: string; label: string }[]>;
  /**
   * Consolidated product → CS-route view across all branches. After CEO
   * directive 2026-05, routing is global — writes fan out to every branch so
   * any branch's rules are an authoritative source. We deduplicate by
   * `productId` and surface one row per product. The `id` field is just the
   * canonical (first-branch) rule id; deletes are dispatched by `productId`.
   */
  rules: CsRoutingRuleRow[];
  /** The single global routing mode (read from any branch — they all agree post-fan-out). */
  relationshipMode: CsRoutingRelationshipMode;
}

interface TeamOpt {
  id: string;
  label: string;
}

async function fetchCsTeamsForBranch(cookie: string, branchId: string): Promise<TeamOpt[]> {
  const teamsInput = encodeURIComponent(JSON.stringify({ branchId }));
  const teamsRes = await apiRequest<unknown>(
    `/trpc/branches.listTeamsWithMembers?input=${teamsInput}`,
    { method: 'GET', cookie },
  );
  const teamsPayload = teamsRes.ok
    ? ((teamsRes.data as {
        result?: { data?: Array<{ id: string; department: string; name: string | null }> };
      })?.result?.data ?? [])
    : [];
  return teamsPayload
    .filter((t) => t.department === 'CS')
    .map((t) => ({
      id: t.id,
      label: t.name?.trim() || 'CS team',
    }));
}

async function fetchModeAndRulesForBranch(
  cookie: string,
  branchId: string,
): Promise<{ rules: CsRoutingRuleRow[]; relationshipMode: CsRoutingRelationshipMode }> {
  const branchInput = encodeURIComponent(JSON.stringify({ ownerBranchId: branchId }));
  const [rulesRes, settingsRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/orders.listCsRoutingRules?input=${branchInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/orders.getCsRoutingBranchSettings?input=${branchInput}`, { method: 'GET', cookie }),
  ]);
  const rules = rulesRes.ok
    ? ((rulesRes.data as { result?: { data?: CsRoutingRuleRow[] } })?.result?.data ?? [])
    : [];
  // No settings row yet → branch is unconfigured → use the new default.
  const sm = settingsRes.ok
    ? ((settingsRes.data as { result?: { data?: { relationshipMode: CsRoutingRelationshipMode } } })?.result?.data
        ?.relationshipMode ?? 'SPLIT_ALL_BRANCHES')
    : 'SPLIT_ALL_BRANCHES';
  return { rules, relationshipMode: sm };
}

export async function loadCsOrderRoutingPageData(
  request: Request,
  _user: CsOrderRoutingViewer,
): Promise<CsOrderRoutingLoaderData> {
  const cookie = getSessionCookie(request);

  const branchesP = apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie });
  const productsInput = JSON.stringify({
    page: 1,
    limit: 100,
    status: 'ACTIVE' as const,
    sortBy: 'name' as const,
    sortOrder: 'asc' as const,
  });
  const productsP = apiRequest<unknown>(
    `/trpc/products.list?input=${encodeURIComponent(productsInput)}`,
    { method: 'GET', cookie },
  );

  const [branchesRes, productsRes] = await Promise.all([branchesP, productsP]);

  const branches = branchesRes.ok
    ? ((branchesRes.data as { result?: { data?: CsOrderRoutingLoaderData['branches'] } })?.result?.data ?? [])
    : [];

  const productPayload = productsRes.ok
    ? ((productsRes.data as { result?: { data?: { products?: Array<{ id: string; name: string }> } } })?.result?.data
        ?.products ?? [])
    : [];

  const teamsByBranchId: Record<string, TeamOpt[]> = {};

  if (branches.length > 0) {
    const entries = await Promise.all(
      branches.map(async (b) => {
        const teams = await fetchCsTeamsForBranch(cookie ?? '', b.id);
        return [b.id, teams] as const;
      }),
    );
    for (const [id, teams] of entries) {
      teamsByBranchId[id] = teams;
    }
  }

  // Read mode + rules from EVERY branch and consolidate. Post-fan-out writes
  // keep every branch in sync, so reading from one would suffice — but a union
  // also recovers cleanly from any historical drift left by the per-branch
  // editor that used to live here. Same productId across branches is collapsed
  // to one row using the first-encountered mapping.
  let rules: CsRoutingRuleRow[] = [];
  // Default to SPLIT_ALL_BRANCHES per CEO directive — the "org-wide pool" mode
  // is the new starting point for fresh installations.
  let relationshipMode: CsRoutingRelationshipMode = 'SPLIT_ALL_BRANCHES';

  if (branches.length > 0) {
    const perBranch = await Promise.all(
      branches.map((b) => fetchModeAndRulesForBranch(cookie ?? '', b.id)),
    );
    // Mode priority on drift: PRODUCT_ALLOCATION (most explicit) >
    // SPLIT_ALL_BRANCHES > BRANCH_DEFAULT (most generic legacy fallback).
    if (perBranch.some((r) => r.relationshipMode === 'PRODUCT_ALLOCATION')) {
      relationshipMode = 'PRODUCT_ALLOCATION';
    } else if (perBranch.some((r) => r.relationshipMode === 'SPLIT_ALL_BRANCHES')) {
      relationshipMode = 'SPLIT_ALL_BRANCHES';
    } else {
      relationshipMode = 'BRANCH_DEFAULT';
    }

    const seen = new Set<string>();
    for (const { rules: branchRules } of perBranch) {
      for (const r of branchRules) {
        const key = r.productId ?? `__noproduct__${r.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rules.push(r);
      }
    }
  }

  return {
    branches,
    products: productPayload,
    teamsByBranchId,
    rules,
    relationshipMode,
  };
}

type RoutingTargetPayload = {
  servicingBranchId: string;
  teamId?: string | null;
  weight?: number;
};

export type CsOrderRoutingMutationPayload =
  | {
      intent: 'setCsRoutingRelationshipMode';
      relationshipMode: CsRoutingRelationshipMode;
    }
  | {
      intent: 'bulkUpsertProductRoutingRules';
      productIds: string[];
      servicingBranchId: string;
      teamId?: string | null;
    }
  | {
      intent: 'deleteProductRouting';
      productId: string;
    }
  // Legacy intents kept for backward compat with any open form/widget that may
  // still POST them (e.g. a stale tab). Each is rewritten to a global op.
  | { intent: 'deleteCsRoutingRule'; ruleId: string; productId?: string | null };

async function listAllBranchIds(cookie: string): Promise<string[]> {
  const res = await apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie });
  if (!res.ok) return [];
  const list =
    ((res.data as { result?: { data?: Array<{ id: string }> } })?.result?.data ?? []).map((b) => b.id);
  return list;
}

async function listRulesForBranch(cookie: string, ownerBranchId: string): Promise<CsRoutingRuleRow[]> {
  const branchInput = encodeURIComponent(JSON.stringify({ ownerBranchId }));
  const res = await apiRequest<unknown>(
    `/trpc/orders.listCsRoutingRules?input=${branchInput}`,
    { method: 'GET', cookie },
  );
  if (!res.ok) return [];
  return ((res.data as { result?: { data?: CsRoutingRuleRow[] } })?.result?.data ?? []);
}

export async function handleCsOrderRoutingFormJson(request: Request, formData: FormData) {
  const cookie = getSessionCookie(request);
  const raw = formData.get('json')?.toString();
  if (!raw) {
    return json({ error: 'Missing payload' }, { status: 400 });
  }
  let payload: CsOrderRoutingMutationPayload;
  try {
    payload = JSON.parse(raw) as CsOrderRoutingMutationPayload;
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const branchIds = await listAllBranchIds(cookie ?? '');
  if (branchIds.length === 0) {
    return json({ error: 'No branches found — set up a branch first' }, { status: 400 });
  }

  // ── Set global routing mode ─────────────────────────────────────
  if (payload.intent === 'setCsRoutingRelationshipMode') {
    const results = await Promise.all(
      branchIds.map((bid) =>
        apiRequest<unknown>('/trpc/orders.setCsRoutingRelationshipMode', {
          method: 'POST',
          cookie,
          body: { ownerBranchId: bid, relationshipMode: payload.relationshipMode },
        }),
      ),
    );
    const firstFail = results.find((r) => !r.ok);
    if (firstFail) {
      return json(
        { error: extractApiErrorMessage(firstFail.data, 'Save failed') },
        { status: safeStatus(firstFail.status) },
      );
    }
    return json({ success: true as const });
  }

  // ── Bulk product → CS routing (global) ───────────────────────────
  if (payload.intent === 'bulkUpsertProductRoutingRules') {
    const servicingBranchId = payload.servicingBranchId?.trim();
    if (!servicingBranchId) {
      return json({ error: 'Servicing branch is required' }, { status: 400 });
    }
    const uniqueProducts = [...new Set(payload.productIds.filter((id) => typeof id === 'string' && id.trim()))];
    if (uniqueProducts.length === 0) {
      return json({ error: 'Select at least one product' }, { status: 400 });
    }
    const targetTeamId = payload.teamId?.trim() ? payload.teamId.trim() : null;

    // Load existing rules per branch in parallel so we can decide create vs update.
    const rulesByBranch = await Promise.all(
      branchIds.map(async (bid) => ({ branchId: bid, rules: await listRulesForBranch(cookie ?? '', bid) })),
    );

    const ops: Array<Promise<{ ok: boolean; status: number; data: unknown }>> = [];
    for (const { branchId: bid, rules: branchRules } of rulesByBranch) {
      const existingByProduct = new Map<string, CsRoutingRuleRow>();
      for (const r of branchRules) {
        if (r.productId) existingByProduct.set(r.productId, r);
      }
      for (const productId of uniqueProducts) {
        const existing = existingByProduct.get(productId);
        const targets = [{ servicingBranchId, teamId: targetTeamId, weight: 1 }];
        if (existing) {
          ops.push(
            apiRequest<unknown>('/trpc/orders.updateCsRoutingRule', {
              method: 'POST',
              cookie,
              body: {
                ruleId: existing.id,
                productId,
                priority: existing.priority ?? 0,
                enabled: true,
                strategy: 'EQUAL',
                targets,
              },
            }),
          );
        } else {
          ops.push(
            apiRequest<unknown>('/trpc/orders.createCsRoutingRule', {
              method: 'POST',
              cookie,
              body: {
                ownerBranchId: bid,
                productId,
                priority: 0,
                enabled: true,
                strategy: 'EQUAL',
                targets,
              },
            }),
          );
        }
      }
    }

    const results = await Promise.all(ops);
    const firstFail = results.find((r) => !r.ok);
    if (firstFail) {
      return json(
        { error: extractApiErrorMessage(firstFail.data, 'Save failed') },
        { status: safeStatus(firstFail.status) },
      );
    }
    return json({ success: true as const });
  }

  // ── Remove a product's routing globally ──────────────────────────
  if (payload.intent === 'deleteProductRouting') {
    const productId = payload.productId?.trim();
    if (!productId) {
      return json({ error: 'productId is required' }, { status: 400 });
    }
    const rulesByBranch = await Promise.all(
      branchIds.map((bid) => listRulesForBranch(cookie ?? '', bid)),
    );
    const ruleIds: string[] = [];
    for (const branchRules of rulesByBranch) {
      for (const r of branchRules) {
        if (r.productId === productId) ruleIds.push(r.id);
      }
    }
    if (ruleIds.length === 0) {
      // Nothing to remove — idempotent success.
      return json({ success: true as const });
    }
    const results = await Promise.all(
      ruleIds.map((ruleId) =>
        apiRequest<unknown>('/trpc/orders.deleteCsRoutingRule', {
          method: 'POST',
          cookie,
          body: { ruleId },
        }),
      ),
    );
    const firstFail = results.find((r) => !r.ok);
    if (firstFail) {
      return json(
        { error: extractApiErrorMessage(firstFail.data, 'Remove failed') },
        { status: safeStatus(firstFail.status) },
      );
    }
    return json({ success: true as const });
  }

  // ── Legacy: single-rule delete (rewrite to global product delete) ──
  if (payload.intent === 'deleteCsRoutingRule') {
    if (payload.productId) {
      // Delegate to the new global path.
      const fd = new FormData();
      fd.set('json', JSON.stringify({ intent: 'deleteProductRouting', productId: payload.productId }));
      return handleCsOrderRoutingFormJson(request, fd);
    }
    // No product id supplied — fall back to deleting just the one rule.
    const res = await apiRequest<unknown>('/trpc/orders.deleteCsRoutingRule', {
      method: 'POST',
      cookie,
      body: { ruleId: payload.ruleId },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Delete failed') }, { status: safeStatus(res.status) });
    }
    return json({ success: true as const });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}
