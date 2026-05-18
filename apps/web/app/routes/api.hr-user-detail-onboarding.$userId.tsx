import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { authorizeUserDetailBundle } from '~/lib/hr-user-detail-bundle-access.server';
import { fetchHrUserDetailOnboardingSlice } from '~/lib/hr-user-detail-overview-slices.server';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = params['userId'];
  if (!userId) return json({ ok: false as const, error: 'User id required' });

  const gate = await authorizeUserDetailBundle(request, userId);
  if (!gate.ok) return gate.response;

  const { onboardingSummary } = await fetchHrUserDetailOnboardingSlice({
    cookie: gate.cookie,
    userId,
  });

  return secondaryCacheJson({
    ok: true as const,
    onboardingSummary,
  });
}
