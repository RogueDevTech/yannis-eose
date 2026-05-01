import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getCurrentUser, getSessionCookie, safeStatus } from '~/lib/api.server';
import { RoleTemplatesPage } from '~/features/settings/RoleTemplatesPage';
import type { PermissionCatalogRow, RoleTemplateOption } from '~/features/users/types';

export const meta: MetaFunction = () => [{ title: 'Role templates — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw new Response('Unauthorized', { status: 401 });
  const perms = user.permissions ?? [];
  if (user.role !== 'SUPER_ADMIN' && !perms.includes('rbac.manage_templates')) {
    throw new Response('Forbidden', { status: 403 });
  }

  const cookie = getSessionCookie(request);
  const [templatesRes, permRes] = await Promise.all([
    apiRequest<unknown>('/trpc/roleTemplates.list', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/permissions.listCodes', { method: 'GET', cookie }),
  ]);

  const templatesPayload = templatesRes.ok
    ? ((templatesRes.data as { result?: { data?: { templates?: RoleTemplateOption[] } } })?.result?.data?.templates ??
        []) as RoleTemplateOption[]
    : [];

  const permPayload = permRes.ok
    ? ((permRes.data as { result?: { data?: { permissions?: PermissionCatalogRow[] } } })?.result?.data
        ?.permissions ?? []) as PermissionCatalogRow[]
    : [];

  return json({ templates: templatesPayload, permissions: permPayload });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
  const perms = user.permissions ?? [];
  if (user.role !== 'SUPER_ADMIN' && !perms.includes('rbac.manage_templates')) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const cookie = getSessionCookie(request);
  const fd = await request.formData();
  const intent = fd.get('intent')?.toString() ?? '';

  try {
    if (intent === 'getTemplate') {
      const templateId = fd.get('templateId')?.toString() ?? '';
      const res = await apiRequest<unknown>('/trpc/roleTemplates.get', {
        method: 'POST',
        cookie,
        body: { templateId },
      });
      if (!res.ok) {
        return json({ error: 'Failed to load template' }, { status: safeStatus(res.status) });
      }
      const data = (res.data as { result?: { data?: { permissionCodes?: string[] } } })?.result?.data;
      return json({ permissionCodes: data?.permissionCodes ?? [] });
    }

    if (intent === 'createTemplate') {
      const key = fd.get('key')?.toString() ?? '';
      const name = fd.get('name')?.toString() ?? '';
      const description = fd.get('description')?.toString() || undefined;
      const codesRaw = fd.get('permissionCodes')?.toString() ?? '[]';
      const permissionCodes = JSON.parse(codesRaw) as string[];
      const res = await apiRequest<unknown>('/trpc/roleTemplates.create', {
        method: 'POST',
        cookie,
        body: { key, name, description, permissionCodes },
      });
      if (!res.ok) return json({ error: 'Create failed' }, { status: safeStatus(res.status) });
      return json({ ok: true as const });
    }

    if (intent === 'setTemplatePermissions') {
      const templateId = fd.get('templateId')?.toString() ?? '';
      const codesRaw = fd.get('permissionCodes')?.toString() ?? '[]';
      const permissionCodes = JSON.parse(codesRaw) as string[];
      const res = await apiRequest<unknown>('/trpc/roleTemplates.setPermissions', {
        method: 'POST',
        cookie,
        body: { templateId, permissionCodes },
      });
      if (!res.ok) return json({ error: 'Save failed' }, { status: safeStatus(res.status) });
      return json({ ok: true as const });
    }

    return json({ error: 'Unknown intent' }, { status: 400 });
  } catch {
    return json({ error: 'Invalid request' }, { status: 400 });
  }
}

export default function RoleTemplatesRoute() {
  const data = useLoaderData<typeof loader>();
  return <RoleTemplatesPage templates={data.templates} permissions={data.permissions} />;
}
