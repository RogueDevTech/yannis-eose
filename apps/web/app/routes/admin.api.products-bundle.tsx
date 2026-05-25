import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'products.update');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();

  const productId = formData.get('productId')?.toString();
  const componentsRaw = formData.get('components')?.toString() ?? '[]';

  if (!productId) {
    return json({ error: 'Product ID required' }, { status: 400 });
  }

  let components: Array<{ componentProductId: string; quantity: number }>;
  try {
    components = JSON.parse(componentsRaw);
    if (!Array.isArray(components)) throw new Error('not array');
  } catch {
    return json({ error: 'Invalid components data' }, { status: 400 });
  }

  const res = await apiRequest<unknown>('/trpc/products.setBundleComponents', {
    method: 'POST',
    cookie,
    body: { productId, components },
  });

  if (!res.ok) {
    return json(
      { error: extractApiErrorMessage(res.data, 'Failed to save bundle components') },
      { status: 200 },
    );
  }

  return json({ success: true });
}
