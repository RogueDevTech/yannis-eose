import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermissionOrRoles,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import {
  StaffOnboardingPage,
  type OnboardingRecord,
} from '~/features/onboarding/StaffOnboardingPage';

export const meta: MetaFunction = () => [{ title: 'Staff Onboarding — Yannis EOSE' }];

const HR_ACCESS = {
  roles: ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'],
  permission: ['hr.onboarding.read', 'hr.onboarding.write'],
} as const;

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: [...HR_ACCESS.roles],
    permission: [...HR_ACCESS.permission],
  });
  const userId = params['id'];
  if (!userId) throw new Response('Missing user id', { status: 400 });
  const cookie = getSessionCookie(request);

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
      result?: { data?: { user?: { id: string; name: string } } | { id: string; name: string } };
    })?.result?.data ?? null;
  if (!record || !userPayload) {
    throw new Response('Missing payload', { status: 500 });
  }
  // users.getById returns either { user } or the user directly depending on path; handle both.
  const user =
    'id' in (userPayload as { id?: string }) && 'name' in (userPayload as { name?: string })
      ? (userPayload as { id: string; name: string })
      : ((userPayload as { user: { id: string; name: string } }).user);

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

  return { record, subject: { id: user.id, name: user.name }, approverName };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: [...HR_ACCESS.roles],
    permission: [...HR_ACCESS.permission],
  });
  const userId = params['id'];
  if (!userId) return json({ error: 'Missing user id' }, { status: 400 });
  const cookie = getSessionCookie(request);
  const fd = await request.formData();
  const intent = fd.get('intent')?.toString();

  if (intent === 'updateOnboarding') {
    const supportingDocsRaw = fd.get('supportingDocuments')?.toString() ?? '[]';
    let supportingDocuments: Array<{ label: string; url: string }>;
    try {
      const parsed = JSON.parse(supportingDocsRaw);
      supportingDocuments = Array.isArray(parsed) ? parsed : [];
    } catch {
      return json({ error: 'Invalid supporting documents payload' }, { status: 400 });
    }
    const body = {
      userId,
      gender: emptyToNull(fd.get('gender')),
      dateOfBirth: emptyToNull(fd.get('dateOfBirth')),
      residentialAddress: emptyToNull(fd.get('residentialAddress')),
      proofOfAddressUrl: emptyToNull(fd.get('proofOfAddressUrl')),
      supportingDocuments,
      guarantor1Name: emptyToNull(fd.get('guarantor1Name')),
      guarantor1Phone: emptyToNull(fd.get('guarantor1Phone')),
      guarantor1Email: emptyToNull(fd.get('guarantor1Email')),
      guarantor1Address: emptyToNull(fd.get('guarantor1Address')),
      guarantor1Relationship: emptyToNull(fd.get('guarantor1Relationship')),
      guarantor1LetterUrl: emptyToNull(fd.get('guarantor1LetterUrl')),
      guarantor2Name: emptyToNull(fd.get('guarantor2Name')),
      guarantor2Phone: emptyToNull(fd.get('guarantor2Phone')),
      guarantor2Email: emptyToNull(fd.get('guarantor2Email')),
      guarantor2Address: emptyToNull(fd.get('guarantor2Address')),
      guarantor2Relationship: emptyToNull(fd.get('guarantor2Relationship')),
      guarantor2LetterUrl: emptyToNull(fd.get('guarantor2LetterUrl')),
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

  if (intent === 'submitOnboarding') {
    const res = await apiRequest<unknown>('/trpc/onboarding.submit', {
      method: 'POST',
      cookie,
      body: { userId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to submit onboarding') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = v.toString().trim();
  return s.length === 0 ? null : s;
}

export default function HrOnboardingRoute() {
  const { record, subject, approverName } = useLoaderData<typeof loader>();
  return (
    <StaffOnboardingPage
      mode="hr"
      subject={subject}
      record={record as OnboardingRecord}
      actionUrl={`/hr/users/${subject.id}/onboarding`}
      showBackToProfile
      approverName={approverName}
    />
  );
}
