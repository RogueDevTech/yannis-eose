import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { DuplicateRulesPage, type DuplicateRulesData } from '~/features/settings/DuplicateRulesPage';

export const meta: MetaFunction = () => [{ title: 'Duplicate rules — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'settings.write');
  const cookie = getSessionCookie(request);
  const res = await apiRequest<{ result?: { data?: DuplicateRulesData } }>('/trpc/settings.getDuplicateRules', {
    method: 'GET',
    cookie,
  });
  if (!res.ok || !res.data?.result?.data) {
    throw new Response(extractApiErrorMessage(res.data, 'Failed to load duplicate rules'), { status: safeStatus(res.status) });
  }
  return json(res.data.result.data);
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'settings.write');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  if (formData.get('intent')?.toString() !== 'save') {
    return json({ error: 'Unknown action' }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(formData.get('rules')?.toString() ?? '');
  } catch {
    return json({ error: 'Invalid duplicate rules' }, { status: 400 });
  }
  const res = await apiRequest<unknown>('/trpc/settings.updateDuplicateRules', { method: 'POST', cookie, body });
  if (!res.ok) {
    return json({ error: extractApiErrorMessage(res.data, 'Failed to save duplicate rules') }, { status: safeStatus(res.status) });
  }
  return json({ success: true, message: 'Duplicate rules saved' });
}

export default function DuplicateRulesRoute() {
  const data = useLoaderData<typeof loader>();
  return <DuplicateRulesPage data={data as unknown as DuplicateRulesData} />;
}
