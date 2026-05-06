import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getCurrentUser,
  getSessionCookie,
} from '~/lib/api.server';
import { actorUserIdsMatch } from '~/lib/rbac';
import type {
  PendingEmailChange,
  PermissionCatalogBundle,
  RoleTemplateOption,
  UserCreateCommissionPlan,
  UserCreateLocation,
  UserCreateProduct,
  UserDetail,
  UserOnboardingSummary,
  UserPushStatus,
} from '~/features/users/types';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return json({ ok: false as const, error: 'Not authenticated' });
  }
  const cookie = getSessionCookie(request);
  const userId = params['userId'];
  if (!userId) return json({ ok: false as const, error: 'User id required' });

  const userRes = await apiRequest<unknown>(
    `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  );
  if (!userRes.ok) return json({ ok: false as const, error: 'User not found' });
  const profileUser =
    (userRes.data as { result?: { data?: UserDetail } })?.result?.data ?? null;
  if (!profileUser) return json({ ok: false as const, error: 'User not found' });

  const isSelfView =
    actorUserIdsMatch(currentUser.id, profileUser.id) || actorUserIdsMatch(currentUser.id, userId);
  const headOfCSViewingTeam =
    currentUser.role === 'HEAD_OF_CS' && ['CS_AGENT', 'HEAD_OF_CS'].includes(profileUser.role);
  const headOfMarketingViewingTeam =
    currentUser.role === 'HEAD_OF_MARKETING' && ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(profileUser.role);
  const isHoMOrHoCS = currentUser.role === 'HEAD_OF_MARKETING' || currentUser.role === 'HEAD_OF_CS';

  if (!isSelfView && isHoMOrHoCS && !headOfCSViewingTeam && !headOfMarketingViewingTeam) {
    return json({ ok: false as const, error: 'This user is not on your team.' }, { status: 403 });
  }

  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const productsInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 20, sortBy: 'name', sortOrder: 'asc' }));
  const locationsInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 20 }));
  const plansInput = encodeURIComponent(JSON.stringify({ activeOnly: true }));

  const [productsRes, roleTemplatesRes, locationsRes, plansRes, pendingEmailRes, onboardingRes, pushStatusRes, catalogRes, baselinesRes, stampPreviewRes] =
    await Promise.all([
      apiRequest<unknown>(`/trpc/products.list?input=${productsInput}`, opt),
      apiRequest<unknown>('/trpc/roleTemplates.list', opt),
      apiRequest<unknown>(`/trpc/logistics.listLocations?input=${locationsInput}`, opt),
      apiRequest<unknown>(`/trpc/hr.listPlans?input=${plansInput}`, opt),
      apiRequest<unknown>(`/trpc/users.getPendingEmailChange?input=${encodeURIComponent(JSON.stringify({ userId }))}`, opt),
      apiRequest<unknown>(`/trpc/onboarding.get?input=${encodeURIComponent(JSON.stringify({ userId }))}`, opt),
      apiRequest<unknown>(`/trpc/notifications.getUserPushStatus?input=${encodeURIComponent(JSON.stringify({ userId }))}`, opt),
      apiRequest<unknown>('/trpc/permissions.listCatalog', opt),
      apiRequest<unknown>('/trpc/permissions.listTemplateBaselines', opt),
      apiRequest<unknown>(
        `/trpc/permissions.getUserMatrix?input=${encodeURIComponent(JSON.stringify({ userId, intent: 'stamp_preview' }))}`,
        opt,
      ),
    ]);

  const products =
    productsRes.ok
      ? ((productsRes.data as { result?: { data?: { products?: UserCreateProduct[] } } })?.result?.data?.products ?? [])
      : ([] as UserCreateProduct[]);
  const roleTemplates =
    roleTemplatesRes.ok
      ? ((roleTemplatesRes.data as { result?: { data?: { templates?: RoleTemplateOption[] } } })?.result?.data?.templates ?? [])
      : ([] as RoleTemplateOption[]);
  const locations =
    locationsRes.ok
      ? (((locationsRes.data as { result?: { data?: { locations?: Array<{ id: string; name: string; address: string; providerName?: string | null }> } } })
          ?.result?.data?.locations ?? []) as Array<{ id: string; name: string; address: string; providerName?: string | null }>).map((l) => ({
          id: l.id,
          name: l.name,
          address: l.address,
          providerName: l.providerName ?? null,
        }))
      : ([] as UserCreateLocation[]);
  const plans =
    plansRes.ok
      ? ((plansRes.data as { result?: { data?: { plans?: UserCreateCommissionPlan[] } } })?.result?.data?.plans ?? [])
      : ([] as UserCreateCommissionPlan[]);

  const pendingEmailChange =
    pendingEmailRes.ok
      ? ((pendingEmailRes.data as { result?: { data?: PendingEmailChange | null } })?.result?.data ?? null)
      : null;

  const onboardingSummary =
    onboardingRes.ok
      ? ((onboardingRes.data as { result?: { data?: UserOnboardingSummary | null } })?.result?.data ?? null)
      : null;

  const pushStatus =
    pushStatusRes.ok
      ? ((pushStatusRes.data as { result?: { data?: UserPushStatus | null } })?.result?.data ?? null)
      : null;

  const permissionCatalog: PermissionCatalogBundle = {
    items:
      catalogRes.ok
        ? ((catalogRes.data as { result?: { data?: { permissions?: unknown[] } } })?.result?.data?.permissions ?? []).filter(
            (x): x is any => !!x,
          )
        : [],
    requestFailed: !catalogRes.ok,
  };

  const templatePermissionsById =
    baselinesRes.ok
      ? ((baselinesRes.data as { result?: { data?: Record<string, string[]> } })?.result?.data ?? {})
      : {};

  const userStampPreview =
    stampPreviewRes.ok
      ? ((stampPreviewRes.data as { result?: { data?: { userOverrides: Record<string, boolean>; templateCodes: string[]; effectiveCodes: string[] } } })
          ?.result?.data ?? { userOverrides: {}, templateCodes: [], effectiveCodes: [] })
      : { userOverrides: {}, templateCodes: [], effectiveCodes: [] };

  return secondaryCacheJson({
    ok: true as const,
    products,
    roleTemplates,
    locations,
    plans,
    pendingEmailChange,
    onboardingSummary,
    pushStatus,
    permissionCatalog,
    templatePermissionsById,
    userStampPreview,
  });
}

