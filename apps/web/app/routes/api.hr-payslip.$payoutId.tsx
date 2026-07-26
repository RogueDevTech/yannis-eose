import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getCurrentUser, getSessionCookie } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import type { PayslipApiRow } from '~/features/hr/payslip-mappers';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false as const, error: 'Unauthorized', payslip: null }, { status: 401 });
  }

  const payoutId = params['payoutId'];
  if (!payoutId) {
    return json({ ok: false as const, error: 'Payslip ID required', payslip: null }, { status: 400 });
  }

  const cookie = getSessionCookie(request);
  const res = await apiRequest<unknown>(
    `/trpc/hr.getPayslip?input=${encodeURIComponent(JSON.stringify({ payoutId }))}`,
    { method: 'GET', cookie },
  );

  if (!res.ok) {
    const err = extractApiErrorMessage(res.data, 'Payslip could not be loaded');
    const status = err.toLowerCase().includes('not allowed') ? 403 : 400;
    return json({ ok: false as const, error: err, payslip: null }, { status });
  }

  const payslip = ((res.data as { result?: { data?: PayslipApiRow } })?.result?.data ??
    null) as PayslipApiRow | null;
  if (!payslip) {
    return json({ ok: false as const, error: 'Payslip not found', payslip: null }, { status: 404 });
  }

  return json({ ok: true as const, payslip, error: null });
}
