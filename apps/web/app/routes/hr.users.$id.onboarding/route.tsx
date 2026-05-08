import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { Await, useLoaderData } from '@remix-run/react';
import {
  apiRequest,
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

export const meta: MetaFunction = () => [{ title: 'Staff Onboarding — Yannis EOSE' }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireOnboardingHrPagesAccess(request);
  const userId = params['id'];
  if (!userId) throw new Response('Missing user id', { status: 400 });
  const cookie = getSessionCookie(request);

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

  return {
    record,
    subject: { id: user.id, name: user.name, role: user.role },
    approverName,
  };
  })();

  return defer({ pageData });
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireOnboardingHrPagesAccess(request);
  const userId = params['id'];
  if (!userId) return json({ error: 'Missing user id' }, { status: 400 });
  const cookie = getSessionCookie(request);
  const fd = await request.formData();
  const intent = fd.get('intent')?.toString();

  if (intent === 'updateOnboarding' || intent === 'submitOnboarding') {
    return json(
      {
        error:
          'Onboarding can only be edited or submitted by the staff member from their own page under Admin → Your onboarding (/admin/onboarding).',
      },
      { status: 403 },
    );
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
    <Suspense fallback={<UserOnboardingLoadingShell />}>
      <Await resolve={pageData}>
        {(data) => (
          <StaffOnboardingPage
            mode="hr"
            subject={data.subject}
            record={data.record as OnboardingRecord}
            actionUrl={`/hr/users/${data.subject.id}/onboarding`}
            showBackToProfile
            approverName={data.approverName}
          />
        )}
      </Await>
    </Suspense>
  );
}
