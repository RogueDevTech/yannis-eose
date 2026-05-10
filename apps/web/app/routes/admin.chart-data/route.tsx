import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser, defaultThisMonthRange } from '~/lib/api.server';
import type { ChartDataPayload } from '~/features/ceo/types';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN')) {
    return json({ error: 'Forbidden' } satisfies ChartDataPayload, { status: 403 });
  }

  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  let startDate = url.searchParams.get('startDate') ?? undefined;
  let endDate = url.searchParams.get('endDate') ?? undefined;
  const rawTopic = url.searchParams.get('topic');
  const topic = rawTopic === 'media_buyers' || rawTopic === 'cs' ? rawTopic : 'orders';

  if (!periodAllTime && !startDate && !endDate) {
    const range = defaultThisMonthRange();
    startDate = range.startDate;
    endDate = range.endDate;
  }
  if (periodAllTime) {
    startDate = undefined;
    endDate = undefined;
  }

  const ceoInput = JSON.stringify({ startDate, endDate });
  const opts = { method: 'GET' as const, cookie };

  const [timeSeriesRes, orderPipelineRes, leaderboardRes, csWorkloadsRes] = await Promise.all([
    apiRequest<{ result?: { data?: { date: string; revenue: number; orderCount: number; createdCount: number }[] } }>(
      `/trpc/dashboard.ceoOverviewTimeSeries?input=${encodeURIComponent(ceoInput)}`,
      opts,
    ),
    apiRequest<{ result?: { data?: { volume: number; unconfirmed: number; confirmed: number; logisticsDistributed: number; delivered: number } } }>(
      `/trpc/dashboard.orderPipelineChart?input=${encodeURIComponent(ceoInput)}`,
      opts,
    ),
    topic === 'media_buyers'
      ? apiRequest<{
          result?: {
            data?: Array<{
              mediaBuyerId: string;
              name: string;
              email?: string;
              totalSpend: number;
              totalOrders: number;
              deliveredOrders: number;
              deliveredRevenue: number;
              confirmedOrders: number;
              confirmationRate: number;
              cpa: number;
              trueRoas: number;
              deliveryRate: number;
              profitabilityScore: number | null;
            }>;
          };
        }>(
          `/trpc/marketing.leaderboard?input=${encodeURIComponent(JSON.stringify({ period: startDate && endDate ? 'this_month' : 'all_time', startDate, endDate }))}`,
          opts,
        )
      : Promise.resolve({ ok: false, data: null }),
    topic === 'cs'
      ? apiRequest<{ result?: { data?: Array<{ agentId: string; agentName: string; capacity: number; pendingCount: number; lastActionAt?: string | null }> } }>(
          '/trpc/orders.csWorkloads?input=%7B%7D',
          opts,
        )
      : Promise.resolve({ ok: false, data: null }),
  ]);

  const timeSeries =
    timeSeriesRes.ok && Array.isArray(timeSeriesRes.data?.result?.data)
      ? timeSeriesRes.data.result.data
      : [];
  const orderPipelineChart =
    orderPipelineRes.ok && orderPipelineRes.data?.result?.data
      ? orderPipelineRes.data.result.data
      : { volume: 0, unconfirmed: 0, confirmed: 0, logisticsDistributed: 0, delivered: 0 };

  const payload: ChartDataPayload = {
    timeSeries,
    orderPipelineChart,
  };

  if (topic === 'media_buyers' && leaderboardRes.ok && Array.isArray(leaderboardRes.data?.result?.data)) {
    payload.chartTopicData = { mediaBuyerLeaderboard: leaderboardRes.data.result.data };
  }
  if (topic === 'cs' && csWorkloadsRes.ok && Array.isArray(csWorkloadsRes.data?.result?.data)) {
    payload.chartTopicData = { csWorkloads: csWorkloadsRes.data.result.data };
  }

  return json(payload);
}

export default function AdminChartDataRoute() {
  return null;
}
