import type { ActionFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie } from '~/lib/api.server';

const VOIP_TOKEN_PATH = '/trpc/voip.generateToken';

/** Truncate for debug logs (avoid huge payloads). */
function truncate(str: string, max = 400): string {
  return str.length <= max ? str : str.slice(0, max) + '…';
}

/**
 * Resource route: POST /api/voip-token
 *
 * Proxies the VOIP token request to the NestJS API with the session cookie.
 * Used when web and API are on different origins (e.g. separate Cloudflare
 * tunnels) so the browser sends the cookie to this same-origin URL and the
 * server forwards it to the API.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cookie = getSessionCookie(request);
  const res = await apiRequest<{ result?: { data?: { token?: string } }; token?: string; error?: unknown }>(
    VOIP_TOKEN_PATH,
    { method: 'POST', body: {}, cookie },
  );

  const status = res.status;
  const body = JSON.stringify(res.data);

  if (!res.ok) {
    console.error('[VOIP token proxy] API returned error:', {
      status,
      path: VOIP_TOKEN_PATH,
      hasCookie: Boolean(cookie),
      bodyPreview: truncate(body),
    });
  }

  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
