import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { Await, useLoaderData } from '@remix-run/react';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { isAdminLevel } from '~/lib/rbac';
import { apiRequest, getCurrentUser, getSessionCookie, safeStatus } from '~/lib/api.server';
import {
  RoleTemplatesPage,
  type PermissionCatalogRow,
} from '~/features/settings/RoleTemplatesPage';
import { RoleTemplatesLoadingShell } from '~/features/settings/SettingsDeferredLoadingShells';
import type { RoleTemplateOption } from '~/features/users/types';

export const meta: MetaFunction = () => [{ title: 'Role templates — Yannis EOSE' }];

/** Mirrors `RoleTemplatesService.listTemplates` — same users who can list templates may open this route. */
function canAccessRoleTemplates(user: { role: string; permissions?: string[] }) {
  const effective = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));
  return (
    isAdminLevel(user) ||
    effective.has('rbac.templates.manage') ||
    effective.has('users.staff.create') ||
    effective.has('users.staff.update') ||
    effective.has('users.staff.view')
  );
}

/** Matches tRPC mutations on this page (`roleTemplates.*`, `permissions.listCatalog` for catalog). */
function canMutateRoleTemplates(user: { role: string; permissions?: string[] }) {
  if (isAdminLevel(user)) return true;
  const effective = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));
  return effective.has('rbac.templates.manage');
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw new Response('Unauthorized', { status: 401 });
  if (!canAccessRoleTemplates(user)) {
    throw new Response('Forbidden', { status: 403 });
  }

  const cookie = getSessionCookie(request);
  const pageData = (async () => {
  const [templatesRes, permRes, baselinesRes] = await Promise.all([
    apiRequest<unknown>('/trpc/roleTemplates.list', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/permissions.listCatalog', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/permissions.listTemplateBaselines', { method: 'GET', cookie }),
  ]);

  const rawTemplates = templatesRes.ok
    ? ((templatesRes.data as { result?: { data?: { templates?: RoleTemplateOption[] } } })?.result?.data?.templates ??
        []) as RoleTemplateOption[]
    : [];

  const rawPerms = permRes.ok
    ? ((permRes.data as { result?: { data?: { permissions?: PermissionCatalogRow[] } } })?.result?.data
        ?.permissions ?? []) as PermissionCatalogRow[]
    : [];

  const templatePermissionsById = baselinesRes.ok
    ? ((baselinesRes.data as { result?: { data?: { byTemplateId?: Record<string, string[]> } } })?.result?.data
        ?.byTemplateId ?? {}) as Record<string, string[]>
    : {};

  const templatesPayload = Array.isArray(rawTemplates) ? rawTemplates : [];
  const permPayload = Array.isArray(rawPerms) ? rawPerms : [];

  return { templates: templatesPayload, permissions: permPayload, templatePermissionsById };
  })();

  return defer({ pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!canMutateRoleTemplates(user)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const cookie = getSessionCookie(request);
  const fd = await request.formData();
  const intent = fd.get('intent')?.toString() ?? '';

  try {
    if (intent === 'getTemplate') {
      const templateId = fd.get('templateId')?.toString() ?? '';
      // tRPC queries use GET + ?input={json} — POST is for mutations only (see trpc-openapi-docs).
      const input = encodeURIComponent(JSON.stringify({ templateId }));
      const res = await apiRequest<unknown>(`/trpc/roleTemplates.get?input=${input}`, {
        method: 'GET',
        cookie,
      });
      if (!res.ok) {
        return json({ error: 'Failed to load template' }, { status: safeStatus(res.status) });
      }
      const data = (res.data as { result?: { data?: { permissionCodes?: string[] } } })?.result?.data;
      return json({
        templateId,
        permissionCodes: data?.permissionCodes ?? [],
      });
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
      return json({ success: true as const });
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
      return json({ success: true as const });
    }

    return json({ error: 'Unknown intent' }, { status: 400 });
  } catch {
    return json({ error: 'Invalid request' }, { status: 400 });
  }
}

export default function RoleTemplatesRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<RoleTemplatesLoadingShell />}>
      <Await resolve={pageData}>
        {(data) => (
          <RoleTemplatesPage
            templates={data.templates}
            permissions={data.permissions}
            templatePermissionsById={data.templatePermissionsById}
          />
        )}
      </Await>
    </Suspense>
  );
}
