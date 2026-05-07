import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (params.id) {
    return redirect(`/admin/marketing/offers/${params.id}/edit${url.search}`);
  }
  const dest = new URL('/admin/products', url.origin);
  dest.searchParams.set('tab', 'offers');
  return redirect(dest.pathname + dest.search);
}

