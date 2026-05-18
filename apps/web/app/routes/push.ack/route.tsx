import type { ActionFunctionArgs } from '@remix-run/node';

/**
 * Proxies POST /push/ack from the browser/service worker to the Nest API.
 * The SW runs on the web origin; the API lives on API_URL — this avoids split-host 404s in dev and production.
 */
const API_URL = process.env['API_URL'] ?? 'http://localhost:4444';

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ ok: false }, 405);
  }

  const body = await request.text();
  const res = await fetch(`${API_URL}/push/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
  });
}

export async function loader() {
  return json({ ok: false }, 405);
}
