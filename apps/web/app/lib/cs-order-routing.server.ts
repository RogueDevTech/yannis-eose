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
  rules: CsRoutingRuleRow[];
  selectedBranchId: string | null;
  branchAdminLocked: boolean;
  /** Present when `selectedBranchId` is set — how rules are interpreted for this funnel branch. */
  relationshipMode: CsRoutingRelationshipMode | null;
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

export async function loadCsOrderRoutingPageData(
  request: Request,
  user: CsOrderRoutingViewer,
): Promise<CsOrderRoutingLoaderData> {
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  const branchAdminLocked = user.role === 'BRANCH_ADMIN';
  const selectedBranchId = branchAdminLocked
    ? user.currentBranchId ?? null
    : url.searchParams.get('branchId')?.trim() || null;

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

  let rules: CsRoutingRuleRow[] = [];
  let relationshipMode: CsRoutingRelationshipMode | null = null;

  if (selectedBranchId) {
    const branchInput = encodeURIComponent(JSON.stringify({ ownerBranchId: selectedBranchId }));
    const [rulesRes, settingsRes] = await Promise.all([
      apiRequest<unknown>(`/trpc/orders.listCsRoutingRules?input=${branchInput}`, { method: 'GET', cookie }),
      apiRequest<unknown>(`/trpc/orders.getCsRoutingBranchSettings?input=${branchInput}`, { method: 'GET', cookie }),
    ]);
    rules = rulesRes.ok
      ? ((rulesRes.data as { result?: { data?: CsRoutingRuleRow[] } })?.result?.data ?? [])
      : [];
    if (settingsRes.ok) {
      const sm = (settingsRes.data as { result?: { data?: { relationshipMode: CsRoutingRelationshipMode } } })?.result?.data
        ?.relationshipMode;
      relationshipMode = sm ?? 'BRANCH_DEFAULT';
    } else {
      relationshipMode = 'BRANCH_DEFAULT';
    }
  }

  return {
    branches,
    products: productPayload,
    teamsByBranchId,
    rules,
    selectedBranchId,
    branchAdminLocked,
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
      intent: 'createCsRoutingRule';
      ownerBranchId: string;
      productId?: string | null;
      priority?: number;
      enabled?: boolean;
      strategy?: 'WEIGHTED' | 'EQUAL';
      targets: RoutingTargetPayload[];
    }
  | {
      intent: 'updateCsRoutingRule';
      ruleId: string;
      productId?: string | null;
      priority?: number;
      enabled?: boolean;
      strategy?: 'WEIGHTED' | 'EQUAL';
      targets: RoutingTargetPayload[];
    }
  | { intent: 'deleteCsRoutingRule'; ruleId: string }
  | {
      intent: 'setCsRoutingRelationshipMode';
      ownerBranchId: string;
      relationshipMode: CsRoutingRelationshipMode;
    };

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

  if (payload.intent === 'setCsRoutingRelationshipMode') {
    const res = await apiRequest<unknown>('/trpc/orders.setCsRoutingRelationshipMode', {
      method: 'POST',
      cookie,
      body: {
        ownerBranchId: payload.ownerBranchId,
        relationshipMode: payload.relationshipMode,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Save failed') }, { status: safeStatus(res.status) });
    }
    return json({ success: true as const });
  }

  if (payload.intent === 'deleteCsRoutingRule') {
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

  if (payload.intent === 'createCsRoutingRule') {
    const res = await apiRequest<unknown>('/trpc/orders.createCsRoutingRule', {
      method: 'POST',
      cookie,
      body: {
        ownerBranchId: payload.ownerBranchId,
        productId: payload.productId ?? null,
        priority: payload.priority ?? 0,
        enabled: payload.enabled ?? true,
        strategy: payload.strategy ?? 'EQUAL',
        targets: payload.targets.map((t) => ({
          servicingBranchId: t.servicingBranchId,
          teamId: t.teamId ?? null,
          weight: t.weight ?? 1,
        })),
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Create failed') }, { status: safeStatus(res.status) });
    }
    return json({ success: true as const });
  }

  if (payload.intent === 'updateCsRoutingRule') {
    const res = await apiRequest<unknown>('/trpc/orders.updateCsRoutingRule', {
      method: 'POST',
      cookie,
      body: {
        ruleId: payload.ruleId,
        productId: payload.productId,
        priority: payload.priority,
        enabled: payload.enabled,
        strategy: payload.strategy,
        targets: payload.targets.map((t) => ({
          servicingBranchId: t.servicingBranchId,
          teamId: t.teamId ?? null,
          weight: t.weight ?? 1,
        })),
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Update failed') }, { status: safeStatus(res.status) });
    }
    return json({ success: true as const });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}
