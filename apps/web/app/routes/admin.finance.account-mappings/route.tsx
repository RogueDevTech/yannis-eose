import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermissionOrRoles,
} from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { AccountMappingsLoadingShell } from '~/features/accounting/AccountMappingsLoadingShell';
import {
  AccountMappingsPage,
  type AccountMappingRow,
  type AccountOption,
} from '~/features/accounting/AccountMappingsPage';

export const meta: MetaFunction = () => [
  { title: 'Account Mappings — Accounting — Yannis EOSE' },
];

export { cachedClientLoader as clientLoader };

interface MappingResult {
  mappingKey: string;
  label: string;
  category: string;
  defaultCode: string;
  isCustom: boolean;
  account: { id: string; code: string; name: string } | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'],
    permission: 'finance.ledger.read',
  });
  const cookie = getSessionCookie(request);
  const perms = (user as { permissions?: string[] }).permissions ?? [];
  const canWrite =
    isAdminLevel(user) ||
    user.role === 'FINANCE_OFFICER' ||
    perms.includes('finance.ledger.write');

  const shell = { canWrite };

  const pageData = (async () => {
    const [mappingsRes, accountsRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/generalLedger.listAccountMappings?input=${encodeURIComponent(JSON.stringify({}))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/generalLedger.listAccounts?input=${encodeURIComponent(JSON.stringify({ includeInactive: false }))}`,
        { method: 'GET', cookie },
      ),
    ]);

    const mappings: AccountMappingRow[] = mappingsRes.ok
      ? ((mappingsRes.data as { result?: { data?: MappingResult[] } })?.result?.data ?? []).map(
          (m: MappingResult) => ({
            mappingKey: m.mappingKey,
            label: m.label,
            category: m.category,
            defaultCode: m.defaultCode,
            isCustom: m.isCustom,
            accountId: m.account?.id ?? '',
            accountCode: m.account?.code ?? m.defaultCode,
            accountName: m.account?.name ?? 'Not found',
          }),
        )
      : [];

    const accounts: AccountOption[] = accountsRes.ok
      ? (
          (accountsRes.data as { result?: { data?: Array<{ id: string; code: string; name: string; isGroup: boolean; rootType: string; accountType?: string | null }> } })?.result?.data ?? []
        )
          .filter((a) => !a.isGroup)
          .map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            rootType: a.rootType,
            accountType: a.accountType ?? undefined,
          }))
      : [];

    return { mappings, accounts };
  })();

  return defer({ shell, pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'updateMapping') {
    const mappingKey = formData.get('mappingKey')?.toString() ?? '';
    const accountId = formData.get('accountId')?.toString() ?? '';

    const res = await apiRequest<unknown>('/trpc/generalLedger.updateAccountMapping', {
      method: 'POST',
      cookie,
      body: { mappingKey, accountId },
    });

    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data) || 'Failed to update mapping.' },
        { status: 400 },
      );
    }
    return json({ success: true });
  }

  if (intent === 'bulkUpdateMappings') {
    const overridesRaw = formData.get('overrides')?.toString() ?? '{}';
    let overrides: Record<string, string> = {};
    try { overrides = JSON.parse(overridesRaw); } catch { /* ignore */ }

    const entries = Object.entries(overrides);
    if (entries.length === 0) return json({ error: 'No changes to save' }, { status: 400 });

    // Save each mapping sequentially
    for (const [mappingKey, accountId] of entries) {
      const res = await apiRequest<unknown>('/trpc/generalLedger.updateAccountMapping', {
        method: 'POST',
        cookie,
        body: { mappingKey, accountId },
      });
      if (!res.ok) {
        return json(
          { error: extractApiErrorMessage(res.data) || `Failed to update ${mappingKey}` },
          { status: 400 },
        );
      }
    }
    return json({ success: true });
  }

  if (intent === 'resetMapping') {
    const mappingKey = formData.get('mappingKey')?.toString() ?? '';

    const res = await apiRequest<unknown>('/trpc/generalLedger.resetAccountMapping', {
      method: 'POST',
      cookie,
      body: { mappingKey },
    });

    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data) || 'Failed to reset mapping.' },
        { status: 400 },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function AccountMappingsRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();

  return (
    <CachedAwait
      resolve={pageData}
      fallback={<AccountMappingsLoadingShell canWrite={shell.canWrite} />}
    >
      {(data) => (
        <AccountMappingsPage
          mappings={data.mappings}
          accounts={data.accounts}
          canWrite={shell.canWrite}
        />
      )}
    </CachedAwait>
  );
}
