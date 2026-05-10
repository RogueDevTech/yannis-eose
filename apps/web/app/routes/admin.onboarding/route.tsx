import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getCurrentUser, getSessionCookie, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import {
  StaffOnboardingPage,
  type OnboardingRecord,
} from '~/features/onboarding/StaffOnboardingPage';

export const meta: MetaFunction = () => [{ title: 'Your Onboarding — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) {
    const url = new URL(request.url);
    const dest = url.pathname + (url.search || '');
    throw redirect(`/auth?redirectTo=${encodeURIComponent(dest)}`);
  }
  const cookie = getSessionCookie(request);
  const res = await apiRequest<unknown>('/trpc/onboarding.get', { method: 'GET', cookie });
  if (!res.ok) {
    throw new Response('Failed to load onboarding', { status: safeStatus(res.status) });
  }
  const record =
    (res.data as { result?: { data?: OnboardingRecord } })?.result?.data ?? null;
  if (!record) {
    throw new Response('No onboarding payload', { status: 500 });
  }
  // Include the user's role so StaffOnboardingPage can pick the right reviewer copy
  // (HR / Admin / SuperAdmin onboardings are reviewed by SuperAdmin, not HR).
  return {
    record,
    subject: { id: user.id, name: user.name, role: user.role },
    isMirroring: !!user.mirroredBy,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });
  // Mirror Mode is strictly view-only. The tRPC layer blocks the underlying mutation, but
  // we short-circuit here so the user gets a clean error instead of a tRPC 403. See
  // CLAUDE.md → "Mirror Mode".
  const actor = await getCurrentUser(request);
  if (actor?.mirroredBy) {
    return json(
      { error: 'Read-only while mirroring user. Exit mirror mode to make changes.' },
      { status: 403 },
    );
  }
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
      payoutBankName: emptyToNull(fd.get('payoutBankName')),
      payoutAccountName: emptyToNull(fd.get('payoutAccountName')),
      payoutAccountNumber: emptyToNull(fd.get('payoutAccountNumber')),
      payoutBankCode: emptyToNull(fd.get('payoutBankCode')),
    };
    const res = await apiRequest<unknown>('/trpc/onboarding.update', {
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

  if (intent === 'submitOnboarding') {
    const res = await apiRequest<unknown>('/trpc/onboarding.submit', {
      method: 'POST',
      cookie,
      body: {},
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

export default function AdminSelfOnboardingRoute() {
  const { record, subject, isMirroring } = useLoaderData<typeof loader>();
  return (
    <StaffOnboardingPage
      mode="self"
      subject={subject}
      record={record as OnboardingRecord}
      actionUrl="/admin/onboarding"
      isMirroring={isMirroring}
    />
  );
}
