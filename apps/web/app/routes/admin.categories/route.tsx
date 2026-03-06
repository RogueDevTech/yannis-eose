import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useActionData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { CategoriesPage } from '~/features/categories/CategoriesPage';

export const meta: MetaFunction = () => [
  { title: 'Product Categories — Yannis EOSE' },
];

interface Category {
  id: string;
  name: string;
  brandName: string;
  brandPhone: string | null;
  brandEmail: string | null;
  brandWhatsapp: string | null;
  smsSenderId: string | null;
  status: string;
  createdAt: string;
}

interface LoaderData {
  categories: Category[];
  total: number;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'categories.read');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const search = url.searchParams.get('search') || undefined;
  const status = url.searchParams.get('status') || undefined;

  const input: Record<string, unknown> = { page: 1, limit: 20 };
  if (search) input.search = search;
  if (status) input.status = status;

  const res = await apiRequest<unknown>(
    `/trpc/productCategories.list?input=${encodeURIComponent(JSON.stringify(input))}`,
    { method: 'GET', cookie },
  );

  if (!res.ok) {
    return { categories: [], total: 0 } satisfies LoaderData;
  }

  const trpcData = res.data as { result?: { data?: { categories: Category[]; pagination: { total: number } } } };
  const result = trpcData?.result?.data;

  return {
    categories: result?.categories ?? [],
    total: result?.pagination?.total ?? 0,
  } satisfies LoaderData;
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'create') {
    const body = {
      name: formData.get('name')?.toString() ?? '',
      brandName: formData.get('brandName')?.toString() ?? '',
      brandPhone: formData.get('brandPhone')?.toString() || undefined,
      brandEmail: formData.get('brandEmail')?.toString() || undefined,
      brandWhatsapp: formData.get('brandWhatsapp')?.toString() || undefined,
      smsSenderId: formData.get('smsSenderId')?.toString() || undefined,
    };

    if (!body.name || !body.brandName) {
      return json({ error: 'Category name and brand name are required', success: false });
    }

    const res = await apiRequest<unknown>('/trpc/productCategories.create', {
      method: 'POST',
      cookie,
      body,
    });

    if (!res.ok) {
      const errData = res.data as { error?: { message?: string } };
      return json({ error: errData?.error?.message ?? 'Failed to create category', success: false });
    }

    return json({ success: true, error: null });
  }

  if (intent === 'update') {
    const categoryId = formData.get('categoryId')?.toString() ?? '';
    const body: Record<string, unknown> = { categoryId };

    const name = formData.get('name')?.toString();
    const brandName = formData.get('brandName')?.toString();
    if (name) body.name = name;
    if (brandName) body.brandName = brandName;
    body.brandPhone = formData.get('brandPhone')?.toString() || null;
    body.brandEmail = formData.get('brandEmail')?.toString() || null;
    body.brandWhatsapp = formData.get('brandWhatsapp')?.toString() || null;
    body.smsSenderId = formData.get('smsSenderId')?.toString() || null;

    const status = formData.get('status')?.toString();
    if (status) body.status = status;

    const res = await apiRequest<unknown>('/trpc/productCategories.update', {
      method: 'POST',
      cookie,
      body,
    });

    if (!res.ok) {
      const errData = res.data as { error?: { message?: string } };
      return json({ error: errData?.error?.message ?? 'Failed to update category', success: false });
    }

    return json({ success: true, error: null });
  }

  return json({ error: 'Unknown action', success: false });
}

export default function CategoriesRoute() {
  const { categories, total } = useLoaderData<LoaderData>();
  const actionData = useActionData<{ error?: string | null; success?: boolean }>();

  return (
    <CategoriesPage
      categories={categories}
      total={total}
      actionData={actionData}
    />
  );
}
