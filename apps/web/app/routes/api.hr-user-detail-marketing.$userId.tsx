import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { authorizeUserDetailBundle } from '~/lib/hr-user-detail-bundle-access.server';
import type { UserMarketingMetrics } from '~/features/users/types';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = params['userId'];
  if (!userId) return json({ ok: false as const, error: 'User id required' });

  const gate = await authorizeUserDetailBundle(request, userId);
  if (!gate.ok) return gate.response;

  const { profileUser, cookie } = gate;

  const isMarketingRole =
    profileUser.role === 'MEDIA_BUYER' || profileUser.role === 'HEAD_OF_MARKETING';

  if (!isMarketingRole) {
    return secondaryCacheJson({
      ok: true as const,
      marketingMetrics: null as UserMarketingMetrics | null,
      fundingBalance: null as {
        totalReceived: string;
        totalDistributed: string;
        totalSpend: string;
        balance: string;
      } | null,
    });
  }

  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  const [marketingRes, fundingRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/marketing.metrics?input=${encodeURIComponent(JSON.stringify({ mediaBuyerId: userId }))}`,
      opt,
    ),
    apiRequest<unknown>(
      `/trpc/marketing.getFundingBalance?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      opt,
    ),
  ]);

  const marketingMetrics = marketingRes.ok
    ? (((marketingRes.data as { result?: { data?: UserMarketingMetrics | null } })?.result?.data ??
        null) as UserMarketingMetrics | null)
    : null;

  const fundingBalance = fundingRes.ok
    ? (((
        fundingRes.data as {
          result?: {
            data?: {
              totalReceived: string;
              totalDistributed: string;
              totalSpend: string;
              balance: string;
            };
          };
        }
      )?.result?.data ?? null) as {
        totalReceived: string;
        totalDistributed: string;
        totalSpend: string;
        balance: string;
      } | null)
    : null;

  return secondaryCacheJson({
    ok: true as const,
    marketingMetrics,
    fundingBalance,
  });
}
