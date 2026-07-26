import { defer, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getCurrentUser } from '~/lib/api.server';
import { authorizeUserDetailBundle } from '~/lib/hr-user-detail-bundle-access.server';
import { extractTrpc } from '~/lib/trpc-extract.server';
import { UserPayrollHistoryPage } from '~/features/users/UserPayrollHistoryPage';
import { UserPayrollHistoryLoadingShell } from '~/features/hr/HRDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'User History — Yannis EOSE' }];

type RawPayout = {
  id: string;
  periodStart: string | Date;
  periodEnd: string | Date;
  baseSalary?: string | number;
  performanceBonus?: string | number;
  addOnsTotal?: string | number;
  deductionsTotal?: string | number;
  totalPayout?: string | number;
  grossPay?: string | number;
  netPay?: string | number;
  status: string;
  createdAt?: string | Date;
};

type RawAdjustment = {
  id: string;
  category?: string;
  type?: string;
  amount: string | number;
  reason?: string | null;
  approvedBy?: string | null;
  status?: string;
  createdAt: string | Date;
};

function mapPayout(row: RawPayout): UserPayoutRecord {
  const base = Number(row.baseSalary ?? 0);
  const bonus = Number(row.performanceBonus ?? 0);
  const addOns = Number(row.addOnsTotal ?? 0);
  const deductions = Number(row.deductionsTotal ?? 0);
  const grossFromParts = base + bonus + addOns;
  const gross = Number(row.grossPay ?? 0) > 0 ? Number(row.grossPay) : grossFromParts;
  const net =
    Number(row.netPay ?? 0) > 0
      ? Number(row.netPay)
      : Number(row.totalPayout ?? 0) > 0
        ? Number(row.totalPayout)
        : Math.max(0, gross - deductions);

  return {
    id: row.id,
    periodStart: new Date(row.periodStart).toISOString(),
    periodEnd: new Date(row.periodEnd).toISOString(),
    grossAmount: String(gross),
    deductions: String(deductions),
    netAmount: String(net),
    status: row.status,
    paidAt: row.status === 'PAID' && row.createdAt ? new Date(row.createdAt).toISOString() : null,
  };
}

function mapAdjustment(row: RawAdjustment): UserAdjustment {
  const type = String(row.category ?? row.type ?? 'OTHER');
  const status =
    row.status ??
    (row.approvedBy ? 'APPROVED' : 'PENDING');
  return {
    id: row.id,
    type,
    amount: String(row.amount ?? 0),
    reason: row.reason ?? '',
    status,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);

  const userId = params['id'];
  if (!userId) throw new Response('User ID required', { status: 400 });

  const gate = await authorizeUserDetailBundle(request, userId);
  if (!gate.ok) {
    if (gate.response.status === 403) throw new Response('Forbidden', { status: 403 });
    throw new Response('User not found', { status: 404 });
  }

  const { profileUser, cookie } = gate;
  const opt = { method: 'GET' as const, cookie };

  const pageData = (async () => {
    const [payoutsRes, adjustmentsRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/hr.listPayouts?input=${encodeURIComponent(
          JSON.stringify({ staffId: userId, page: 1, limit: 50 }),
        )}`,
        opt,
      ),
      apiRequest<unknown>(
        `/trpc/hr.listAdjustments?input=${encodeURIComponent(JSON.stringify({ staffId: userId }))}`,
        opt,
      ),
    ]);

    const payoutPayload = payoutsRes.ok
      ? ((payoutsRes.data as { result?: { data?: { payouts?: RawPayout[] } } })?.result?.data?.payouts ??
        [])
      : [];
    const payouts = payoutPayload.map(mapPayout);

    const adjustmentsPayload = adjustmentsRes.ok ? extractTrpc(adjustmentsRes, null) : null;
    const adjustments = Array.isArray(adjustmentsPayload)
      ? (adjustmentsPayload as RawAdjustment[]).map(mapAdjustment)
      : [];

    return {
      userId,
      userName: profileUser.name,
      payouts,
      adjustments,
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function UserHistoryRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<UserPayrollHistoryLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => (
        <UserPayrollHistoryPage
          userId={data.userId}
          userName={data.userName}
          payouts={data.payouts}
          adjustments={data.adjustments}
        />
      )}
    </CachedAwait>
  );
}
