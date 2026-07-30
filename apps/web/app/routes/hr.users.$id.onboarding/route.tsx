import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';

import { Await, useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getCurrentUser,
  getSessionCookie,
  requireOnboardingHrPagesAccess,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import {
  StaffOnboardingPage,
  type OnboardingRecord,
} from '~/features/onboarding/StaffOnboardingPage';
import { UserOnboardingLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';

export const meta: MetaFunction = () => [{ title: 'Staff Onboarding — Yannis EOSE' }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireOnboardingHrPagesAccess(request);
  const userId = params['id'];
  if (!userId) throw new Response('Missing user id', { status: 400 });
  const cookie = getSessionCookie(request);
  // Mirror Mode forces every form field + action button into read-only state.
  const actor = await getCurrentUser(request);
  const isMirroring = !!actor?.mirroredBy;

  const pageData = (async () => {
  const [onboardingRes, userRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/onboarding.get?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  if (!onboardingRes.ok) {
    throw new Response('Failed to load onboarding', { status: safeStatus(onboardingRes.status) });
  }
  if (!userRes.ok) {
    throw new Response('User not found', { status: safeStatus(userRes.status) });
  }

  const record =
    (onboardingRes.data as { result?: { data?: OnboardingRecord } })?.result?.data ?? null;
  const userPayload =
    (userRes.data as {
      result?: {
        data?:
          | { user?: { id: string; name: string; role?: string } }
          | { id: string; name: string; role?: string };
      };
    })?.result?.data ?? null;
  if (!record || !userPayload) {
    throw new Response('Missing payload', { status: 500 });
  }
  // users.getById returns either { user } or the user directly depending on path; handle both.
  const user =
    'id' in (userPayload as { id?: string }) && 'name' in (userPayload as { name?: string })
      ? (userPayload as { id: string; name: string; role?: string })
      : ((userPayload as { user: { id: string; name: string; role?: string } }).user);

  let approverName: string | null = null;
  if (record.approvedBy) {
    const approverRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId: record.approvedBy }))}`,
      { method: 'GET', cookie },
    );
    if (approverRes.ok) {
      const approverPayload = (approverRes.data as { result?: { data?: { user?: { name: string } } | { name: string } } })?.result?.data ?? null;
      if (approverPayload && 'name' in (approverPayload as { name?: string })) {
        approverName = (approverPayload as { name: string }).name;
      } else if (approverPayload && 'user' in approverPayload) {
        approverName = (approverPayload as { user: { name: string } }).user.name;
      }
    }
  }

  const actorPerms = (actor?.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const canHrEdit =
    !!actor &&
    (isAdminLevel(actor) ||
      actorPerms.includes(canonicalPermissionCode('hr.onboarding.write')) ||
      actorPerms.includes(canonicalPermissionCode('hr.onboarding.approve')));

  return {
    record,
    subject: { id: user.id, name: user.name, role: user.role },
    approverName,
    isMirroring,
    canHrEdit,
  };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request, params }: ActionFunctionArgs) {
  await requireOnboardingHrPagesAccess(request);
  // Mirror Mode is strictly view-only — see CLAUDE.md → "Mirror Mode".
  const actor = await getCurrentUser(request);
  if (actor?.mirroredBy) {
    return json(
      { error: 'Read-only while mirroring user. Exit mirror mode to make changes.' },
      { status: 403 },
    );
  }
  const userId = params['id'];
  if (!userId) return json({ error: 'Missing user id' }, { status: 400 });
  const cookie = getSessionCookie(request);
  const fd = await request.formData();
  const intent = fd.get('intent')?.toString();

  if (intent === 'submitOnboarding') {
    return json(
      {
        error:
          'Only the staff member can submit their onboarding from Admin → Your onboarding.',
      },
      { status: 403 },
    );
  }

  if (intent === 'updateOnboarding') {
    const supportingDocsRaw = fd.get('supportingDocuments')?.toString() ?? '[]';
    let supportingDocuments: Array<{ label: string; url: string }>;
    try {
      const parsed = JSON.parse(supportingDocsRaw) as unknown;
      supportingDocuments = Array.isArray(parsed) ? (parsed as Array<{ label: string; url: string }>) : [];
    } catch {
      return json({ error: 'Invalid supporting documents payload' }, { status: 400 });
    }

    const emptyToNull = (v: FormDataEntryValue | null) => {
      const s = v?.toString().trim();
      return s ? s : null;
    };

    const body = {
      userId,
      gender: emptyToNull(fd.get('gender')),
      dateOfBirth: emptyToNull(fd.get('dateOfBirth')),
      residentialAddress: emptyToNull(fd.get('residentialAddress')),
      currentStateOfResidence: emptyToNull(fd.get('currentStateOfResidence')),
      proofOfAddressUrl: emptyToNull(fd.get('proofOfAddressUrl')),
      supportingDocuments,
      signedContractUrl: emptyToNull(fd.get('signedContractUrl')),
      governmentIdUrl: emptyToNull(fd.get('governmentIdUrl')),
      additionalPhoneNumbers: emptyToNull(fd.get('additionalPhoneNumbers')),
      taxId: emptyToNull(fd.get('taxId')),
      rentReceiptUrl: emptyToNull(fd.get('rentReceiptUrl')),
      academicRecordsUrl: emptyToNull(fd.get('academicRecordsUrl')),
      employmentHistoryUrl: emptyToNull(fd.get('employmentHistoryUrl')),
      guarantor1FormUrl: emptyToNull(fd.get('guarantor1FormUrl')),
      guarantor1IdUrl: emptyToNull(fd.get('guarantor1IdUrl')),
      guarantor1Name: emptyToNull(fd.get('guarantor1Name')),
      guarantor1Phone: emptyToNull(fd.get('guarantor1Phone')),
      guarantor1Email: emptyToNull(fd.get('guarantor1Email')),
      guarantor1Address: emptyToNull(fd.get('guarantor1Address')),
      guarantor1Relationship: emptyToNull(fd.get('guarantor1Relationship')),
      guarantor1LetterUrl: emptyToNull(fd.get('guarantor1LetterUrl')),
      guarantor2FormUrl: emptyToNull(fd.get('guarantor2FormUrl')),
      guarantor2IdUrl: emptyToNull(fd.get('guarantor2IdUrl')),
      guarantor2Name: emptyToNull(fd.get('guarantor2Name')),
      guarantor2Phone: emptyToNull(fd.get('guarantor2Phone')),
      guarantor2Email: emptyToNull(fd.get('guarantor2Email')),
      guarantor2Address: emptyToNull(fd.get('guarantor2Address')),
      guarantor2Relationship: emptyToNull(fd.get('guarantor2Relationship')),
      guarantor2LetterUrl: emptyToNull(fd.get('guarantor2LetterUrl')),
      payoutBankName: emptyToNull(fd.get('payoutBankName')),
      payoutAccountName: emptyToNull(fd.get('payoutAccountName')),
      payoutAccountNumber: emptyToNull(fd.get('payoutAccountNumber')),
      payoutBankCode: emptyToNull(fd.get('payoutBankCode')),
    };

    const res = await apiRequest<unknown>('/trpc/onboarding.hrUpdate', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to save onboarding') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'approveOnboarding') {
    const res = await apiRequest<unknown>('/trpc/onboarding.approve', {
      method: 'POST',
      cookie,
      body: { userId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to approve onboarding') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'requestOnboardingChanges') {
    const reason = (fd.get('reason') ?? '').toString().trim();
    if (reason.length < 10) {
      return json(
        { error: 'Please share at least 10 characters describing what needs changes.' },
        { status: 400 },
      );
    }
    const res = await apiRequest<unknown>('/trpc/onboarding.requestChanges', {
      method: 'POST',
      cookie,
      body: { userId, reason },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to send changes request') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function HrOnboardingRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<UserOnboardingLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
        {(data) => (
          <StaffOnboardingPage
            mode="hr"
            subject={data.subject}
            record={data.record as OnboardingRecord}
            actionUrl={`/hr/users/${data.subject.id}/onboarding`}
            showBackToProfile
            approverName={data.approverName}
            isMirroring={data.isMirroring}
            canHrEdit={data.canHrEdit}
          />
        )}
      </CachedAwait>
  );
}
