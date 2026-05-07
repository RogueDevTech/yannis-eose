import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { authorizeUserDetailBundle } from '~/lib/hr-user-detail-bundle-access.server';
import type { UserOnboardingSummary } from '~/features/users/types';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = params['userId'];
  if (!userId) return json({ ok: false as const, error: 'User id required' });

  const gate = await authorizeUserDetailBundle(request, userId);
  if (!gate.ok) return gate.response;

  const { cookie } = gate;
  const onboardingRes = await apiRequest<unknown>(
    `/trpc/onboarding.get?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  );

  let onboardingSummary: UserOnboardingSummary | null = null;

  if (onboardingRes.status === 403) {
    onboardingSummary = { ok: false as const, reason: 'forbidden' as const };
  } else if (!onboardingRes.ok) {
    onboardingSummary = { ok: false as const, reason: 'error' as const };
  } else {
    const d = onboardingRes.data as {
      result?: {
        data?: {
          status?: string;
          submittedAt?: string | null;
          approvedAt?: string | null;
        };
      };
    };
    const row = d?.result?.data;
    if (!row) {
      onboardingSummary = { ok: false as const, reason: 'error' as const };
    } else {
      onboardingSummary = {
        ok: true as const,
        status: row.status ?? 'NOT_STARTED',
        submittedAt: row.submittedAt ?? null,
        approvedAt: row.approvedAt ?? null,
      };
    }
  }

  return secondaryCacheJson({
    ok: true as const,
    onboardingSummary,
  });
}
