import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { LogisticsPage } from '~/features/logistics/LogisticsPage';
import type { Provider, Location, HealthDashboard, LogisticsStreamData } from '~/features/logistics/types';

export const meta: MetaFunction = () => [
  { title: 'Logistics — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'logistics.read');
  const cookie = getSessionCookie(request);

  const canViewEscalations = ['SUPER_ADMIN', 'HEAD_OF_LOGISTICS'].includes(user.role);

  // Start all fetches concurrently
  const providersPromise = apiRequest<unknown>('/trpc/logistics.listProviders', { method: 'GET', cookie });
  const locationsPromise = apiRequest<unknown>('/trpc/logistics.listLocations', { method: 'GET', cookie });
  const healthPromise = canViewEscalations
    ? apiRequest<unknown>('/trpc/logistics.healthDashboard', { method: 'GET', cookie })
    : null;

  // Await only critical data: providers and locations
  const [providersRes, locationsRes] = await Promise.all([providersPromise, locationsPromise]);

  const providersData = providersRes.ok
    ? (providersRes.data as { result?: { data?: { providers: Provider[]; pagination: { total: number } } } })?.result?.data
    : null;

  const locationsData = locationsRes.ok
    ? (locationsRes.data as { result?: { data?: { locations: Location[]; pagination: { total: number } } } })?.result?.data
    : null;

  // healthDashboard returned as un-awaited promise — streams to client
  const healthDashboard = healthPromise
    ? healthPromise
        .then((healthRes) => {
          if (healthRes.ok) {
            return (healthRes.data as { result?: { data?: HealthDashboard } })?.result?.data ?? null;
          }
          return null;
        })
        .catch(() => null as HealthDashboard | null)
    : null;

  return {
    providers: providersData?.providers ?? [],
    totalProviders: providersData?.pagination?.total ?? 0,
    locations: locationsData?.locations ?? [],
    totalLocations: locationsData?.pagination?.total ?? 0,
    healthDashboard,
    canViewEscalations,
  } satisfies LogisticsStreamData;
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createProvider') {
    const res = await apiRequest<unknown>('/trpc/logistics.createProvider', {
      method: 'POST',
      cookie,
      body: {
        name: formData.get('name')?.toString() ?? '',
        contactInfo: formData.get('contactInfo')?.toString() || undefined,
        coverageArea: formData.get('coverageArea')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to create provider' }, { status: res.status });
    }
    return json({ success: true });
  }

  if (intent === 'createLocation') {
    const res = await apiRequest<unknown>('/trpc/logistics.createLocation', {
      method: 'POST',
      cookie,
      body: {
        providerId: formData.get('providerId')?.toString() ?? '',
        name: formData.get('name')?.toString() ?? '',
        address: formData.get('address')?.toString() ?? '',
        coordinates: formData.get('coordinates')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to create location' }, { status: res.status });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function LogisticsRoute() {
  const data = useLoaderData<typeof loader>();
  return <LogisticsPage {...data} />;
}
