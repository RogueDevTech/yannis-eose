import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';

/**
 * Legacy URL — self-service onboarding lives under the admin shell at `/admin/onboarding`.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`/admin/onboarding${url.search}`);
}

export default function OnboardingRedirect() {
  return null;
}
