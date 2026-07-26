import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getCurrentUser, getSessionCookie } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import type { BankPayBatchSection } from '~/lib/bank-pay-pdf';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false as const, error: 'Unauthorized', batches: [] as BankPayBatchSection[] }, { status: 401 });
  }

  const url = new URL(request.url);
  const batchIds = url.searchParams.getAll('batchId').filter(Boolean);
  if (!batchIds.length) {
    return json(
      { ok: false as const, error: 'Select at least one batch', batches: [] as BankPayBatchSection[] },
      { status: 400 },
    );
  }

  const cookie = getSessionCookie(request);
  const res = await apiRequest<unknown>(
    `/trpc/hr.exportBankUpload?input=${encodeURIComponent(JSON.stringify({ batchIds }))}`,
    { method: 'GET', cookie },
  );

  if (!res.ok) {
    return json(
      {
        ok: false as const,
        error: extractApiErrorMessage(res.data, 'Bank pay export failed'),
        batches: [] as BankPayBatchSection[],
      },
      { status: res.status >= 400 && res.status < 600 ? res.status : 400 },
    );
  }

  const data = (res.data as { result?: { data?: { batches?: BankPayBatchSection[] } } })?.result?.data;
  const batches = data?.batches ?? [];
  return json({ ok: true as const, batches, error: null });
}
