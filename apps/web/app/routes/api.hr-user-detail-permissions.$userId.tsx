import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { authorizeUserDetailBundle } from '~/lib/hr-user-detail-bundle-access.server';
import { actorUserIdsMatch } from '~/lib/rbac';
import { extractTrpc } from '~/lib/trpc-extract.server';
import type { PermissionCatalogBundle, PermissionCatalogItem } from '~/features/users/types';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = params['userId'];
  if (!userId) return json({ ok: false as const, error: 'User id required' });

  const gate = await authorizeUserDetailBundle(request, userId);
  if (!gate.ok) return gate.response;

  const { profileUser, cookie, currentUser } = gate;

  if (profileUser.role === 'SUPER_ADMIN') {
    return secondaryCacheJson({
      ok: true as const,
      permissionCatalog: { items: [] as PermissionCatalogItem[], requestFailed: false },
      templatePermissionsById: {} as Record<string, string[]>,
      userStampPreview: {
        userOverrides: {},
        templateCodes: [] as string[],
        effectiveCodes: [] as string[],
      },
    });
  }

  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const isSelfView =
    actorUserIdsMatch(currentUser.id, profileUser.id) || actorUserIdsMatch(currentUser.id, userId);

  const [catalogRes, baselinesRes, stampPreviewRes] = await Promise.all([
    apiRequest<unknown>('/trpc/permissions.listCatalog', opt),
    isSelfView
      ? Promise.resolve({ ok: true as const, data: { result: { data: {} } } })
      : apiRequest<unknown>('/trpc/permissions.listTemplateBaselines', opt),
    apiRequest<unknown>(
      `/trpc/permissions.getUserMatrix?input=${encodeURIComponent(
        JSON.stringify({ userId, intent: 'stamp_preview' }),
      )}`,
      opt,
    ),
  ]);

  const permissionCatalog: PermissionCatalogBundle = catalogRes.ok
    ? {
        items:
          extractTrpc(catalogRes, { permissions: [] as PermissionCatalogItem[] }).permissions ?? [],
        requestFailed: false,
      }
    : { items: [], requestFailed: true };

  const templatePermissionsById =
    baselinesRes.ok && !isSelfView
      ? (extractTrpc(baselinesRes, { byTemplateId: {} as Record<string, string[]> }).byTemplateId ?? {})
      : {};

  const stampData = stampPreviewRes.ok
    ? extractTrpc(stampPreviewRes, {
        userOverrides: {},
        templateCodes: [] as string[],
        effectiveCodes: [] as string[],
      })
    : { userOverrides: {}, templateCodes: [] as string[], effectiveCodes: [] as string[] };

  const userStampPreview = {
    userOverrides: stampData.userOverrides ?? {},
    templateCodes: stampData.templateCodes ?? [],
    effectiveCodes: stampData.effectiveCodes ?? [],
  };

  return secondaryCacheJson({
    ok: true as const,
    permissionCatalog,
    templatePermissionsById,
    userStampPreview,
  });
}
