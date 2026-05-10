import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { authorizeUserDetailBundle } from '~/lib/hr-user-detail-bundle-access.server';
import { fetchHrUserDetailPermissionsSlice } from '~/lib/hr-user-detail-overview-slices.server';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = params['userId'];
  if (!userId) return json({ ok: false as const, error: 'User id required' });

  const gate = await authorizeUserDetailBundle(request, userId);
  if (!gate.ok) return gate.response;

  const { profileUser, cookie, currentUser } = gate;

  const bundle = await fetchHrUserDetailPermissionsSlice({
    cookie,
    currentUser,
    profileUser,
    userId,
  });

  return secondaryCacheJson({
    ok: true as const,
    permissionCatalog: bundle.permissionCatalog,
    templatePermissionsById: bundle.templatePermissionsById,
    userStampPreview: bundle.userStampPreview,
  });
}
