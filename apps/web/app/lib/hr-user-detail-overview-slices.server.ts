import { apiRequest, DEFERRED_LOADER_TIMEOUT_MS } from '~/lib/api.server';
import { actorUserIdsMatch } from '~/lib/rbac';
import { extractTrpc } from '~/lib/trpc-extract.server';
import type {
  PermissionCatalogBundle,
  PermissionCatalogItem,
  UserDetail,
  UserOnboardingSummary,
} from '~/features/users/types';

type CurrentUserLite = { id: string };

function readOnboardingGetRow(raw: unknown): {
  status?: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as Record<string, unknown>;
  const result = root.result;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if ('error' in r && r.error) return null;
    const data = r.data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      return {
        status: typeof d.status === 'string' ? d.status : undefined,
        submittedAt:
          typeof d.submittedAt === 'string' || d.submittedAt === null
            ? (d.submittedAt as string | null)
            : undefined,
        approvedAt:
          typeof d.approvedAt === 'string' || d.approvedAt === null
            ? (d.approvedAt as string | null)
            : undefined,
      };
    }
  }
  return null;
}

export async function fetchHrUserDetailOnboardingSlice(args: {
  cookie: string;
  userId: string;
}): Promise<{ onboardingSummary: UserOnboardingSummary }> {
  const { cookie, userId } = args;
  const onboardingRes = await apiRequest<unknown>(
    `/trpc/onboarding.get?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  );

  let onboardingSummary: UserOnboardingSummary;

  if (onboardingRes.status === 403) {
    onboardingSummary = { ok: false as const, reason: 'forbidden' as const };
  } else if (!onboardingRes.ok) {
    onboardingSummary = { ok: false as const, reason: 'error' as const };
  } else {
    const row = readOnboardingGetRow(onboardingRes.data);
    if (!row) {
      onboardingSummary = { ok: false as const, reason: 'error' as const };
    } else {
      onboardingSummary = {
        ok: true as const,
        status: row.status ?? 'NOT_STARTED',
        submittedAt: row.submittedAt ?? null,
        approvedAt: row.approvedAt ?? null,
      };
    }
  }

  return { onboardingSummary };
}

export type HrUserDetailPermissionsOverviewSlice = {
  permissionCatalog: PermissionCatalogBundle;
  templatePermissionsById: Record<string, string[]>;
  userStampPreview: {
    userOverrides: Record<string, boolean>;
    templateCodes: string[];
    effectiveCodes: string[];
  };
};

export async function fetchHrUserDetailPermissionsSlice(args: {
  cookie: string;
  currentUser: CurrentUserLite;
  profileUser: UserDetail;
  userId: string;
}): Promise<HrUserDetailPermissionsOverviewSlice> {
  const { cookie, currentUser, profileUser, userId } = args;

  if (profileUser.role === 'SUPER_ADMIN') {
    return {
      permissionCatalog: { items: [], requestFailed: false },
      templatePermissionsById: {},
      userStampPreview: {
        userOverrides: {},
        templateCodes: [],
        effectiveCodes: [],
      },
    };
  }

  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const isSelfView =
    actorUserIdsMatch(currentUser.id, profileUser.id) || actorUserIdsMatch(currentUser.id, userId);

  const [catalogRes, baselinesRes, stampPreviewRes] = await Promise.all([
    apiRequest<unknown>('/trpc/permissions.listCatalog', opt),
    isSelfView
      ? Promise.resolve({ ok: true as const, data: { result: { data: {} } } })
      : apiRequest<unknown>('/trpc/permissions.listTemplateBaselines', opt),
    apiRequest<unknown>(
      `/trpc/permissions.getUserMatrix?input=${encodeURIComponent(
        JSON.stringify({ userId, intent: 'stamp_preview' }),
      )}`,
      opt,
    ),
  ]);

  const permissionCatalog: PermissionCatalogBundle = catalogRes.ok
    ? {
        items:
          extractTrpc(catalogRes, { permissions: [] as PermissionCatalogItem[] }).permissions ?? [],
        requestFailed: false,
      }
    : { items: [], requestFailed: true };

  const templatePermissionsById =
    baselinesRes.ok && !isSelfView
      ? (extractTrpc(baselinesRes, { byTemplateId: {} as Record<string, string[]> }).byTemplateId ??
        {})
      : {};

  const stampData = stampPreviewRes.ok
    ? extractTrpc(stampPreviewRes, {
        userOverrides: {},
        templateCodes: [] as string[],
        effectiveCodes: [] as string[],
      })
    : { userOverrides: {}, templateCodes: [] as string[], effectiveCodes: [] as string[] };

  const userStampPreview = {
    userOverrides: stampData.userOverrides ?? {},
    templateCodes: stampData.templateCodes ?? [],
    effectiveCodes: stampData.effectiveCodes ?? [],
  };

  return {
    permissionCatalog,
    templatePermissionsById,
    userStampPreview,
  };
}
