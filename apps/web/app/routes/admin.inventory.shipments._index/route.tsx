import { redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';

function targetUrl(request: Request): string {
  const url = new URL(request.url);
  if (url.searchParams.get('receive') === '1') return '/admin/shipments/receive';
  return `/admin/shipments${url.search}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  return redirect(targetUrl(request), 308);
}

export async function action({ request }: ActionFunctionArgs) {
  return redirect(targetUrl(request), 308);
}

export default function LegacyInventoryShipmentsIndexRoute() {
  return null;
}

