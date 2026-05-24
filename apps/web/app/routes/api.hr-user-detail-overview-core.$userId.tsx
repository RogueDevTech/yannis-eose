import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { authorizeUserDetailBundle } from '~/lib/hr-user-detail-bundle-access.server';
import type {
  PendingEmailChange,
  RoleTemplateOption,
  UserCreateCommissionPlan,
  UserCreateLocation,
  UserCreateProduct,
  UserPushStatus,
} from '~/features/users/types';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = params['userId'];
  if (!userId) return json({ ok: false as const, error: 'User id required' });

  const gate = await authorizeUserDetailBundle(request, userId);
  if (!gate.ok) return gate.response;

  const { cookie, currentUser } = gate;
  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const productsInput = encodeURIComponent(
    JSON.stringify({ page: 1, limit: 20, sortBy: 'name', sortOrder: 'asc' }),
  );
  const locationsInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 20 }));
  const plansInput = encodeURIComponent(JSON.stringify({ activeOnly: true }));

  const isAdminClass = currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'ADMIN' || currentUser.role === 'SUPPORT';

  const [productsRes, roleTemplatesRes, locationsRes, plansRes, pendingEmailRes, pushStatusRes] =
    await Promise.all([
      apiRequest<unknown>(`/trpc/products.options?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`, opt),
      apiRequest<unknown>('/trpc/roleTemplates.list', opt),
      apiRequest<unknown>(`/trpc/logistics.locationOptions?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`, opt),
      apiRequest<unknown>(`/trpc/hr.listPlans?input=${plansInput}`, opt),
      apiRequest<unknown>(
        `/trpc/users.getPendingEmailChange?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
        opt,
      ),
      isAdminClass
        ? apiRequest<unknown>(
            `/trpc/notifications.getPushStatusForUser?input=${encodeURIComponent(
              JSON.stringify({ userId }),
            )}`,
            opt,
          )
        : Promise.resolve({ ok: false as const, data: null }),
    ]);

  const products = productsRes.ok
    ? (((productsRes.data as { result?: { data?: UserCreateProduct[] } })?.result?.data ?? []) as UserCreateProduct[])
    : ([] as UserCreateProduct[]);
  const roleTemplates =
    roleTemplatesRes.ok
      ? ((roleTemplatesRes.data as { result?: { data?: { templates?: RoleTemplateOption[] } } })?.result
          ?.data?.templates ?? [])
      : ([] as RoleTemplateOption[]);
  const locations = locationsRes.ok
    ? (((locationsRes.data as { result?: { data?: UserCreateLocation[] } })?.result?.data ?? []) as UserCreateLocation[])
    : ([] as UserCreateLocation[]);
  const plans =
    plansRes.ok
      ? ((plansRes.data as { result?: { data?: { plans?: UserCreateCommissionPlan[] } } })?.result?.data
          ?.plans ?? [])
      : ([] as UserCreateCommissionPlan[]);

  const pendingEmailChange =
    pendingEmailRes.ok
      ? ((pendingEmailRes.data as { result?: { data?: PendingEmailChange | null } })?.result?.data ?? null)
      : null;

  const pushStatus =
    pushStatusRes.ok
      ? ((pushStatusRes.data as { result?: { data?: UserPushStatus | null } })?.result?.data ?? null)
      : null;

  return secondaryCacheJson({
    ok: true as const,
    products,
    roleTemplates,
    locations,
    plans,
    pendingEmailChange,
    pushStatus,
  });
}
