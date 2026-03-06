import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { LogisticsPage } from '~/features/logistics/LogisticsPage';
import type { Provider, Location, HealthDashboard, LogisticsStreamData } from '~/features/logistics/types';

export const meta: MetaFunction = () => [
  { title: 'Partners — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'logistics.read');
  const cookie = getSessionCookie(request);

  const canViewEscalations = ['SUPER_ADMIN', 'HEAD_OF_LOGISTICS'].includes(user.role);

  const listInput = JSON.stringify({ page: 1, limit: 20 });
  const providersPromise = apiRequest<unknown>(`/trpc/logistics.listProviders?input=${encodeURIComponent(listInput)}`, { method: 'GET', cookie });
  const locationsPromise = apiRequest<unknown>(`/trpc/logistics.listLocations?input=${encodeURIComponent(listInput)}`, { method: 'GET', cookie });
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

  if (intent === 'createProvider' || intent === 'createProviders') {
    const providers: { name: string; contactInfo?: string; coverageArea?: string }[] = [];
    if (intent === 'createProviders') {
      for (let i = 0; i < 50; i++) {
        const name = formData.get(`provider_${i}_name`)?.toString()?.trim();
        if (name) {
          providers.push({
            name,
            contactInfo: formData.get(`provider_${i}_contactInfo`)?.toString()?.trim() || undefined,
            coverageArea: formData.get(`provider_${i}_coverageArea`)?.toString()?.trim() || undefined,
          });
        }
      }
    } else {
      const name = formData.get('name')?.toString()?.trim();
      if (name) {
        providers.push({
          name,
          contactInfo: formData.get('contactInfo')?.toString()?.trim() || undefined,
          coverageArea: formData.get('coverageArea')?.toString()?.trim() || undefined,
        });
      }
    }
    if (providers.length === 0) {
      return json({ error: 'At least one provider with a name is required' }, { status: 400 });
    }
    const errors: string[] = [];
    for (const p of providers) {
      const res = await apiRequest<unknown>('/trpc/logistics.createProvider', {
        method: 'POST',
        cookie,
        body: { name: p.name, contactInfo: p.contactInfo, coverageArea: p.coverageArea },
      });
      if (!res.ok) {
        const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Failed to create provider';
        errors.push(`${p.name}: ${err}`);
      }
    }
    if (errors.length > 0) {
      return json({ error: errors.join('; ') }, { status: 400 });
    }
    return json({ success: true });
  }

  if (intent === 'updateProvider') {
    const res = await apiRequest<unknown>('/trpc/logistics.updateProvider', {
      method: 'POST',
      cookie,
      body: {
        providerId: formData.get('providerId')?.toString() ?? '',
        name: formData.get('name')?.toString()?.trim() || undefined,
        contactInfo: formData.get('contactInfo')?.toString()?.trim() || undefined,
        coverageArea: formData.get('coverageArea')?.toString()?.trim() || undefined,
        status: formData.get('status')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update provider' }, { status: safeStatus(res.status) });
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
      return json({ error: errorData?.error?.message ?? 'Failed to create location' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function LogisticsPartnersRoute() {
  const data = useLoaderData<typeof loader>();
  return <LogisticsPage {...data} />;
}
