import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, getCurrentUser } from '~/lib/api.server';

/**
 * Resource route for filter preferences — proxies tRPC calls so the
 * client-side hook can fetch/save without going through page loaders.
 *
 * GET  /api/filter-preferences?pageKey=admin.marketing.orders
 * POST /api/filter-preferences  { intent: 'upsert' | 'delete', pageKey, filters? }
 */

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const user = await getCurrentUser(request);
    if (!user) return json(null, { status: 401 });
    const cookie = getSessionCookie(request);

    const url = new URL(request.url);
    const pageKey = url.searchParams.get('pageKey');

    if (pageKey) {
      // Get for single page
      const input = encodeURIComponent(JSON.stringify({ pageKey }));
      const res = await apiRequest<unknown>(
        `/trpc/filterPreferences.getForPage?input=${input}`,
        { method: 'GET', cookie },
      );
      if (!res.ok) return json(null);
      const data = (res.data as { result?: { data?: Record<string, string> | null } })?.result?.data;
      return json(data ?? null);
    }

    // Get all
    const res = await apiRequest<unknown>(
      '/trpc/filterPreferences.getAll',
      { method: 'GET', cookie },
    );
    if (!res.ok) return json({});
    const data = (res.data as { result?: { data?: Record<string, Record<string, string>> } })?.result?.data;
    return json(data ?? {});
  } catch {
    return json(null);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const user = await getCurrentUser(request);
    if (!user) return json({ success: false }, { status: 401 });
    const cookie = getSessionCookie(request);

    const body = await request.json() as { intent: string; pageKey: string; filters?: Record<string, string> };

    if (body.intent === 'upsert' && body.pageKey && body.filters) {
      const res = await apiRequest<unknown>('/trpc/filterPreferences.upsert', {
        method: 'POST',
        cookie,
        body: { pageKey: body.pageKey, filters: body.filters },
      });
      return json({ success: res.ok });
    }

    if (body.intent === 'delete' && body.pageKey) {
      const res = await apiRequest<unknown>('/trpc/filterPreferences.delete', {
        method: 'POST',
        cookie,
        body: { pageKey: body.pageKey },
      });
      return json({ success: res.ok });
    }

    return json({ success: false }, { status: 400 });
  } catch {
    return json({ success: false });
  }
}
