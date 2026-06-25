import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requireRole,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { OrdersImportPage } from '~/features/orders/OrdersImportPage';
import type { ProductInfo } from '~/features/orders/orders-import-shared';

export const meta: MetaFunction = () => [
  { title: 'Import orders — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ['SUPER_ADMIN', 'SUPPORT']);
  const cookie = getSessionCookie(request);

  // Fetch products, media buyers, CS agents, and branches in parallel
  const [productsRes, mbRes, csRes, branchesRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 500, status: 'ACTIVE', sortBy: 'name', sortOrder: 'asc' }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ role: 'MEDIA_BUYER', status: 'ACTIVE', limit: 500, sortBy: 'name', sortOrder: 'asc', includeBranchMemberships: false, companyWideUserList: true }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ role: 'CS_CLOSER', status: 'ACTIVE', limit: 500, sortBy: 'name', sortOrder: 'asc', includeBranchMemberships: false, companyWideUserList: true }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/branches.listAll`,
      { method: 'GET', cookie },
    ),
  ]);

  // Products
  type ProductRow = { id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> };
  let products: ProductInfo[] = [];
  if (productsRes.ok) {
    const data = productsRes.data as { result?: { data?: { products?: ProductRow[] } } };
    products = (data?.result?.data?.products ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      offers: p.offers,
    }));
  }

  // Media buyers
  type UserRow = { id: string; name: string; role: string };
  let mediaBuyers: UserRow[] = [];
  if (mbRes.ok) {
    const data = mbRes.data as { result?: { data?: { users?: UserRow[] } } };
    mediaBuyers = (data?.result?.data?.users ?? []).filter((u) => u.role === 'MEDIA_BUYER');
  }

  // CS agents (CS_CLOSER — filtered server-side via role param)
  let csAgents: UserRow[] = [];
  if (csRes.ok) {
    const data = csRes.data as { result?: { data?: { users?: UserRow[] } } };
    csAgents = data?.result?.data?.users ?? [];
  }

  // Branches
  type BranchRow = { id: string; name: string; status?: string };
  let branches: BranchRow[] = [];
  if (branchesRes.ok) {
    const data = branchesRes.data as { result?: { data?: BranchRow[] } };
    branches = (data?.result?.data ?? []).filter((b) => b.status === 'ACTIVE');
  }

  return json({
    products,
    mediaBuyers: mediaBuyers.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    csAgents: csAgents.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    branches: branches.map((b) => ({ id: b.id, name: b.name })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ['SUPER_ADMIN', 'SUPPORT']);
  const cookie = getSessionCookie(request);
  const form = await request.formData();
  const intent = form.get('intent') as string;

  if (intent !== 'importOrder') {
    return json({ error: 'Unknown intent' }, { status: 400 });
  }

  const rowIndexRaw = form.get('rowIndex')?.toString() ?? '';
  const rowIndex = Number.parseInt(rowIndexRaw, 10);

  const customerName = form.get('customerName')?.toString()?.trim() ?? '';
  const customerPhone = form.get('customerPhone')?.toString()?.trim() ?? '';
  const branchId = form.get('branchId')?.toString()?.trim() ?? '';
  const assignedCsId = form.get('assignedCsId')?.toString()?.trim() ?? '';
  const targetStatus = form.get('targetStatus')?.toString()?.trim() ?? 'CS_ASSIGNED';

  if (!customerName || customerName.length < 2) {
    return json({ error: 'Customer name is required (min 2 characters)', rowIndex }, { status: 400 });
  }
  if (!customerPhone) {
    return json({ error: 'Customer phone is required', rowIndex }, { status: 400 });
  }
  if (!branchId) {
    return json({ error: 'Branch is required', rowIndex }, { status: 400 });
  }
  if (!assignedCsId) {
    return json({ error: 'CS agent is required', rowIndex }, { status: 400 });
  }

  const itemsRaw = form.get('items')?.toString() ?? '[]';
  let items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  try {
    items = JSON.parse(itemsRaw);
  } catch {
    return json({ error: 'Invalid items', rowIndex }, { status: 400 });
  }
  if (!items.length || items.some((i) => !i.productId || i.quantity < 1)) {
    return json({ error: 'At least one valid item is required', rowIndex }, { status: 400 });
  }

  const body: Record<string, unknown> = {
    customerName,
    customerPhone,
    branchId,
    assignedCsId,
    targetStatus,
    items,
  };

  const createdAtOverride = form.get('createdAtOverride')?.toString()?.trim();
  if (createdAtOverride) body.createdAtOverride = createdAtOverride;

  const mediaBuyerId = form.get('mediaBuyerId')?.toString()?.trim();
  if (mediaBuyerId) body.mediaBuyerId = mediaBuyerId;

  const customerAddress = form.get('customerAddress')?.toString()?.trim();
  if (customerAddress) body.customerAddress = customerAddress;

  const deliveryAddress = form.get('deliveryAddress')?.toString()?.trim();
  if (deliveryAddress) body.deliveryAddress = deliveryAddress;

  const deliveryState = form.get('deliveryState')?.toString()?.trim();
  if (deliveryState) body.deliveryState = deliveryState;

  const customerEmail = form.get('customerEmail')?.toString()?.trim();
  if (customerEmail) body.customerEmail = customerEmail;

  const customerGender = form.get('customerGender')?.toString()?.trim();
  if (customerGender) body.customerGender = customerGender;

  const deliveryNotes = form.get('deliveryNotes')?.toString()?.trim();
  if (deliveryNotes) body.deliveryNotes = deliveryNotes;

  const totalAmountRaw = form.get('totalAmount')?.toString()?.trim();
  if (totalAmountRaw) {
    const totalAmount = parseFloat(totalAmountRaw);
    if (Number.isFinite(totalAmount) && totalAmount >= 0) body.totalAmount = totalAmount;
  }

  const customFieldsRaw = form.get('customFields')?.toString()?.trim();
  if (customFieldsRaw) {
    try {
      body.customFields = JSON.parse(customFieldsRaw);
    } catch {
      // Non-fatal — skip custom fields on parse failure
    }
  }

  const res = await apiRequest<unknown>('/trpc/orders.importOrder', {
    method: 'POST',
    cookie,
    body,
  });

  if (!res.ok) {
    return json(
      { error: extractApiErrorMessage(res.data, 'Failed to import order'), rowIndex },
      { status: safeStatus(res.status) },
    );
  }

  return json({ success: true, rowIndex });
}

export default function OrdersImportRoute() {
  const { products, mediaBuyers, csAgents, branches } = useLoaderData<typeof loader>();
  return (
    <OrdersImportPage
      products={products}
      mediaBuyers={mediaBuyers}
      csAgents={csAgents}
      branches={branches}
    />
  );
}
