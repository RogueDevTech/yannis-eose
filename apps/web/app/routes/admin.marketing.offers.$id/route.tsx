import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const dest = new URL('/admin/products', url.origin);
  dest.searchParams.set('tab', 'offers');
  if (params.id) dest.searchParams.set('offerGroupId', params.id);
  return redirect(dest.pathname + dest.search);
}

