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
  AccountConfigPage,
  type AccountMappingRow,
  type AccountOption,
} from '~/features/accounting/AccountMappingsPage';
import type { AccountRow } from '~/features/accounting/ChartOfAccountsPage';
import { extractTrpc } from '~/lib/trpc-extract.server';

export const meta: MetaFunction = () => [
  { title: 'Account Config — Accounting — Yannis EOSE' },
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
    roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER', 'ACCOUNTANT'],
    permission: 'accounting.read',
  });
  const cookie = getSessionCookie(request);
  const perms = (user as { permissions?: string[] }).permissions ?? [];
  const canWrite =
    isAdminLevel(user) ||
    user.role === 'FINANCE_OFFICER' ||
    perms.includes('accounting.write');

  const shell = { canWrite };

  const pageData = (async () => {
    const [mappingsRes, accountsRes, jeRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/generalLedger.listAccountMappings?input=${encodeURIComponent(JSON.stringify({}))}`,
        { method: 'GET', cookie },
      ),
      // Full rows incl. inactive: the Accounts tab needs balance/isActive/parent,
      // and must show inactive accounts so they can be reactivated.
      apiRequest<unknown>(
        `/trpc/generalLedger.listAccounts?input=${encodeURIComponent(JSON.stringify({ includeInactive: true }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/generalLedger.listJournalEntries?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 1, search: 'Opening balances (cutover)', status: 'POSTED' }))}`,
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

    const accountRows = accountsRes.ok
      ? extractTrpc<AccountRow[] | null>(accountsRes, null) ?? []
      : [];
    // Leaf/group option list for the mapping selectors (active only).
    const accounts: AccountOption[] = accountRows
      .filter((a) => a.isActive)
      .map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        rootType: a.rootType,
        accountType: a.accountType ?? undefined,
        isGroup: a.isGroup,
      }));

    const jePayload = extractTrpc<{ records?: unknown[] } | null>(jeRes, null);
    const hasOpeningBalances = (jePayload?.records?.length ?? 0) > 0;

    return { mappings, accounts, accountRows, hasOpeningBalances };
  })();

  return defer({ shell, pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createAccount') {
    const accountTypeRaw = formData.get('accountType')?.toString() || '';
    const parentRaw = formData.get('parentAccountId')?.toString() || '';
    const assignToMappingKey = formData.get('assignToMappingKey')?.toString() || '';
    const body = {
      code: formData.get('code')?.toString() ?? '',
      name: formData.get('name')?.toString() ?? '',
      rootType: formData.get('rootType')?.toString() ?? '',
      accountType: accountTypeRaw || null,
      isGroup: formData.get('isGroup')?.toString() === 'true',
      parentAccountId: parentRaw || null,
    };
    const res = await apiRequest<unknown>('/trpc/generalLedger.createAccount', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data) }, { status: 400 });
    }
    const created = (res.data as { result?: { data?: { id: string; code: string; name: string } } })?.result?.data;
    if (assignToMappingKey && created?.id) {
      const mapRes = await apiRequest<unknown>('/trpc/generalLedger.updateAccountMapping', {
        method: 'POST',
        cookie,
        body: { mappingKey: assignToMappingKey, accountId: created.id },
      });
      if (!mapRes.ok) {
        return json(
          {
            success: true,
            intent: 'createAccount',
            account: created,
            assignToMappingKey,
            error: extractApiErrorMessage(mapRes.data) || 'Account created but mapping assign failed.',
          },
          { status: 200 },
        );
      }
    }
    return json({
      success: true,
      intent: 'createAccount',
      account: created ?? null,
      assignToMappingKey: assignToMappingKey || undefined,
    });
  }

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

  // ── Account lifecycle intents (Accounts tab) ──────────────────────────────
  if (intent === 'updateAccount') {
    const body = {
      accountId: formData.get('accountId')?.toString() ?? '',
      name: formData.get('name')?.toString() ?? '',
    };
    const res = await apiRequest<unknown>('/trpc/generalLedger.updateAccount', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data) }, { status: 400 });
    }
    return json({ success: true });
  }

  if (intent === 'deactivateAccount') {
    const body = { accountId: formData.get('accountId')?.toString() ?? '' };
    const res = await apiRequest<unknown>('/trpc/generalLedger.deactivateAccount', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data) }, { status: 400 });
    }
    return json({ success: true });
  }

  if (intent === 'reactivateAccount') {
    const body = { accountId: formData.get('accountId')?.toString() ?? '' };
    const res = await apiRequest<unknown>('/trpc/generalLedger.reactivateAccount', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data) }, { status: 400 });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function AccountConfigRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();

  return (
    <CachedAwait
      resolve={pageData}
      fallback={<AccountMappingsLoadingShell canWrite={shell.canWrite} />}
    >
      {(data) => (
        <AccountConfigPage
          mappings={data.mappings}
          accounts={data.accounts}
          accountRows={data.accountRows}
          hasOpeningBalances={data.hasOpeningBalances}
          canWrite={shell.canWrite}
        />
      )}
    </CachedAwait>
  );
}
