import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { listStaffOnboardingDocumentsSchema } from '@yannis/shared';
import {
  apiRequest,
  getSessionCookie,
  requireOnboardingHrPagesAccess,
  safeStatus,
} from '~/lib/api.server';
import {
  StaffOnboardingDocumentsPage,
  type StaffOnboardingDocumentRow,
} from '~/features/hr/StaffOnboardingDocumentsPage';
import { StaffOnboardingDocsLoadingShell } from '~/features/hr/HRDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Staff onboarding documents — Yannis EOSE' }];

/** Fixed page size for this directory — kept in sync with the UI summary line. */
const STAFF_ONBOARDING_DOCUMENTS_PAGE_SIZE = 20;

type ListPayload = {
  rows: StaffOnboardingDocumentRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

type CountsPayload = {
  total: number;
  NOT_STARTED: number;
  IN_PROGRESS: number;
  SUBMITTED: number;
  APPROVED: number;
};

const EMPTY_COUNTS: CountsPayload = {
  total: 0,
  NOT_STARTED: 0,
  IN_PROGRESS: 0,
  SUBMITTED: 0,
  APPROVED: 0,
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireOnboardingHrPagesAccess(request);
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

  const pageRaw = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const limit = STAFF_ONBOARDING_DOCUMENTS_PAGE_SIZE;

  const rawInput = {
    page,
    limit,
    search: url.searchParams.get('search')?.trim() || undefined,
    onboardingStatus: url.searchParams.get('onboarding') || undefined,
    sortBy: url.searchParams.get('sortBy') || undefined,
    sortOrder: url.searchParams.get('sortOrder') || undefined,
    allBranches: url.searchParams.get('allBranches') === '1',
  };

  const parsed = listStaffOnboardingDocumentsSchema.safeParse(rawInput);
  const input = parsed.success ? parsed.data : listStaffOnboardingDocumentsSchema.parse({ page, limit });

  const inputEnc = encodeURIComponent(JSON.stringify(input));
  const countsInput = encodeURIComponent(
    JSON.stringify({ allBranches: input.allBranches ?? false }),
  );
  const pageData = (async () => {
  const [res, countsRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/onboarding.listStaffDocuments?input=${inputEnc}`, {
      method: 'GET',
      cookie,
    }),
    apiRequest<unknown>(`/trpc/onboarding.countStaffDocumentsByStatus?input=${countsInput}`, {
      method: 'GET',
      cookie,
    }),
  ]);

  const onboardingParam = input.onboardingStatus;
  const sortByParam = input.sortBy;
  const sortOrderParam = input.sortOrder;
  const searchParam = input.search ?? '';

  if (!res.ok) {
    throw new Response('Failed to load onboarding overview', { status: safeStatus(res.status) });
  }

  const data = (res.data as { result?: { data?: ListPayload } })?.result?.data;
  const rows = (data?.rows ?? []) as StaffOnboardingDocumentRow[];
  const pagination = data?.pagination;

  const totalCount = pagination?.total ?? 0;

  const countsData = countsRes.ok
    ? ((countsRes.data as { result?: { data?: CountsPayload } })?.result?.data ?? EMPTY_COUNTS)
    : EMPTY_COUNTS;
  const counts: CountsPayload = {
    total: countsData.total ?? 0,
    NOT_STARTED: countsData.NOT_STARTED ?? 0,
    IN_PROGRESS: countsData.IN_PROGRESS ?? 0,
    SUBMITTED: countsData.SUBMITTED ?? 0,
    APPROVED: countsData.APPROVED ?? 0,
  };

  return {
    rows,
    page: pagination?.page ?? input.page,
    totalPages: pagination?.totalPages ?? 0,
    totalCount,
    pageSize: STAFF_ONBOARDING_DOCUMENTS_PAGE_SIZE,
    onboardingParam,
    sortByParam,
    sortOrderParam,
    searchParam,
    counts,
  };
  })();

  return defer({ pageData });
}

export default function StaffOnboardingDocumentsRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<StaffOnboardingDocsLoadingShell />}>
      {(data) => (
          <StaffOnboardingDocumentsPage
            rows={data.rows}
            page={data.page}
            totalPages={data.totalPages}
            totalCount={data.totalCount}
            pageSize={data.pageSize}
            onboardingParam={data.onboardingParam}
            sortByParam={data.sortByParam}
            sortOrderParam={data.sortOrderParam}
            searchParam={data.searchParam}
            counts={data.counts}
          />
        )}
    </CachedAwait>
  );
}
