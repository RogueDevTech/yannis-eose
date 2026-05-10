import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { secondaryCacheJson } from '~/lib/secondary-api-cache';
import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { authorizeUserDetailBundle } from '~/lib/hr-user-detail-bundle-access.server';
import { canAccessGlobalAuditLog } from '~/lib/rbac';
import { extractTrpc } from '~/lib/trpc-extract.server';
import type {
  UserAdjustment,
  UserApprovalRecord,
  UserAuditEntry,
  UserPayoutRecord,
} from '~/features/users/types';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = params['userId'];
  if (!userId) return json({ ok: false as const, error: 'User id required' });

  const gate = await authorizeUserDetailBundle(request, userId);
  if (!gate.ok) return gate.response;

  const { profileUser, cookie, currentUser } = gate;
  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  const needsPayouts = [
    'MEDIA_BUYER',
    'HEAD_OF_MARKETING',
    'HEAD_OF_CS',
    'CS_CLOSER',
    'TPL_RIDER',
    'HR_MANAGER',
  ].includes(profileUser.role);

  const viewerMayAudit = canAccessGlobalAuditLog(currentUser);
  const isFinanceRole = profileUser.role === 'FINANCE_OFFICER';

  const [payoutsRes, adjustmentsRes, auditRes, financeActivityRes] = await Promise.all([
    needsPayouts
      ? apiRequest<unknown>(
          `/trpc/hr.listPayouts?input=${encodeURIComponent(JSON.stringify({ staffId: userId, limit: 10 }))}`,
          opt,
        )
      : Promise.resolve({ ok: true as const, data: { result: { data: { payouts: [] } } } }),
    apiRequest<unknown>(
      `/trpc/hr.listAdjustments?input=${encodeURIComponent(JSON.stringify({ staffId: userId }))}`,
      opt,
    ),
    viewerMayAudit
      ? apiRequest<unknown>(
          `/trpc/audit.globalLog?input=${encodeURIComponent(
            JSON.stringify({ actorId: userId, page: 1, limit: 20 }),
          )}`,
          opt,
        )
      : Promise.resolve({ ok: true as const, data: { result: { data: { rows: [] } } } }),
    isFinanceRole
      ? apiRequest<unknown>(
          `/trpc/finance.listApprovalRequests?input=${encodeURIComponent(
            JSON.stringify({ approverId: userId, page: 1, limit: 20 }),
          )}`,
          opt,
        )
      : Promise.resolve({ ok: true as const, data: { result: { data: { requests: [], pagination: { total: 0 } } } } }),
  ]);

  const payouts =
    payoutsRes.ok
      ? ((payoutsRes.data as { result?: { data?: { payouts: UserPayoutRecord[] } } })?.result?.data?.payouts ?? [])
      : ([] as UserPayoutRecord[]);

  const adjustmentsPayload = adjustmentsRes.ok ? extractTrpc(adjustmentsRes, null) : null;
  const adjustments = Array.isArray(adjustmentsPayload)
    ? (adjustmentsPayload as UserAdjustment[])
    : ([] as UserAdjustment[]);

  const auditLog = auditRes.ok && viewerMayAudit
    ? ((auditRes.data as { result?: { data?: { rows?: UserAuditEntry[] } } })?.result?.data?.rows ?? [])
    : ([] as UserAuditEntry[]);

  let financeActivity: { approvals: UserApprovalRecord[]; total: number } | null = null;
  if (isFinanceRole && financeActivityRes.ok) {
    const fac = financeActivityRes.data as {
      result?: {
        data?: {
          requests: Array<{
            id: string;
            type: string;
            amount: string;
            description: string;
            status: string;
            approvedAt: string | null;
            createdAt: string;
          }>;
          pagination: { total: number };
        };
      };
    };
    const requests = fac?.result?.data?.requests ?? [];
    financeActivity = {
      approvals: requests.map((r) => ({
        id: r.id,
        type: r.type,
        amount: r.amount,
        description: r.description,
        status: r.status,
        approvedAt: r.approvedAt,
        createdAt: r.createdAt,
      })),
      total: fac?.result?.data?.pagination?.total ?? 0,
    };
  }

  return secondaryCacheJson({
    ok: true as const,
    payouts,
    adjustments,
    auditLog,
    financeActivity,
  });
}
