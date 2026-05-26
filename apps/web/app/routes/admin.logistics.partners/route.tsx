import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { LogisticsPage } from '~/features/logistics/LogisticsPage';
import { LogisticsPartnersLoadingShell } from '~/features/logistics/LogisticsDeferredLoadingShells';
import type { Provider, Location, LogisticsStreamData } from '~/features/logistics/types';

export const meta: MetaFunction = () => [
  { title: 'Logistics companies — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'logistics.providers.view');
  const cookie = getSessionCookie(request);

  const pageData = (async (): Promise<LogisticsStreamData> => {
    // limit 100 (schema max) so the page loads every partner — the Logistics
    // Partners page has no pagination UI and searches client-side.
    const providersInput = JSON.stringify({ page: 1, limit: 100, kind: 'THIRD_PARTY' });
    const locationsInput = JSON.stringify({ page: 1, limit: 100, providerKind: 'THIRD_PARTY' });
    const providersPromise = apiRequest<unknown>(
      `/trpc/logistics.listProviders?input=${encodeURIComponent(providersInput)}`,
      { method: 'GET', cookie },
    );
    const locationsPromise = apiRequest<unknown>(
      `/trpc/logistics.listLocations?input=${encodeURIComponent(locationsInput)}`,
      { method: 'GET', cookie },
    );
    const settingsPromise = apiRequest<unknown>(
      '/trpc/settings.getSystemSettings',
      { method: 'GET', cookie },
    );

    const [providersRes, locationsRes, settingsRes] = await Promise.all([
      providersPromise,
      locationsPromise,
      settingsPromise,
    ]);

    const providersData = providersRes.ok
      ? (providersRes.data as { result?: { data?: { providers: Provider[]; pagination: { total: number } } } })?.result?.data
      : null;

    const locationsData = locationsRes.ok
      ? (locationsRes.data as { result?: { data?: { locations: Location[]; pagination: { total: number } } } })?.result?.data
      : null;

    let globalLowStockThreshold = 10;
    if (settingsRes.ok) {
      const rows =
        (settingsRes.data as { result?: { data?: Array<{ key: string; value: unknown }> } })?.result
          ?.data ?? [];
      const cfg = rows.find((s) => s.key === 'INVENTORY_LOW_STOCK_CONFIG');
      const t = (cfg?.value as { threshold?: number } | null)?.threshold;
      if (typeof t === 'number' && t > 0) globalLowStockThreshold = t;
    }

    return {
      providers: providersData?.providers ?? [],
      totalProviders: providersData?.pagination?.total ?? 0,
      locations: locationsData?.locations ?? [],
      totalLocations: locationsData?.pagination?.total ?? 0,
      globalLowStockThreshold,
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createProvider' || intent === 'createProviders') {
    const providers: { name: string; contactInfo?: string; coverageArea?: string }[] = [];
    if (intent === 'createProviders') {
      for (let i = 0; i < 50; i++) {
        const name = formData.get(`provider_${i}_name`)?.toString()?.trim();
        const contactInfo = formData.get(`provider_${i}_contactInfo`)?.toString()?.trim();
        const coverageArea = formData.get(`provider_${i}_coverageArea`)?.toString()?.trim();
        const anyFilled = Boolean(name || contactInfo || coverageArea);
        if (!anyFilled) continue;
        if (!name) {
          return json({ error: 'Each logistics company row must include a name.' }, { status: 400 });
        }
        if (!contactInfo || !coverageArea) {
          return json(
            { error: 'Contact info and coverage area are required for every logistics company.' },
            { status: 400 },
          );
        }
        providers.push({ name, contactInfo, coverageArea });
      }
    } else {
      const name = formData.get('name')?.toString()?.trim();
      const contactInfo = formData.get('contactInfo')?.toString()?.trim();
      const coverageArea = formData.get('coverageArea')?.toString()?.trim();
      if (name || contactInfo || coverageArea) {
        if (!name || !contactInfo || !coverageArea) {
          return json(
            { error: 'Name, contact info, and coverage area are all required.' },
            { status: 400 },
          );
        }
        providers.push({ name, contactInfo, coverageArea });
      }
    }
    if (providers.length === 0) {
      return json({ error: 'At least one logistics company with a name is required' }, { status: 400 });
    }
    const errors: string[] = [];
    for (const p of providers) {
      const res = await apiRequest<unknown>('/trpc/logistics.createProvider', {
        method: 'POST',
        cookie,
        body: { name: p.name, contactInfo: p.contactInfo, coverageArea: p.coverageArea },
      });
      if (!res.ok) {
        const err = extractApiErrorMessage(res.data, 'Failed to create logistics company');
        errors.push(`${p.name}: ${err}`);
      }
    }
    if (errors.length > 0) {
      return json({ error: errors.join('; ') }, { status: 400 });
    }
    return json({ success: true });
  }

  if (intent === 'updateProvider') {
    const contactInfo = formData.get('contactInfo')?.toString()?.trim();
    const coverageArea = formData.get('coverageArea')?.toString()?.trim();
    if (!contactInfo || !coverageArea) {
      return json({ error: 'Contact info and coverage area are required.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/logistics.updateProvider', {
      method: 'POST',
      cookie,
      body: {
        providerId: formData.get('providerId')?.toString() ?? '',
        name: formData.get('name')?.toString()?.trim() || undefined,
        contactInfo,
        coverageArea,
        status: formData.get('status')?.toString() || undefined,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update logistics company') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'createLocation') {
    const thresholdRaw = formData.get('lowStockThreshold')?.toString().trim() ?? '';
    const thresholdParsed = thresholdRaw === '' ? null : Number.parseInt(thresholdRaw, 10);
    if (thresholdParsed !== null && (!Number.isFinite(thresholdParsed) || thresholdParsed < 1)) {
      return json({ error: 'Low-stock threshold must be a positive whole number.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/logistics.createLocation', {
      method: 'POST',
      cookie,
      body: {
        providerId: formData.get('providerId')?.toString() ?? '',
        name: formData.get('name')?.toString() ?? '',
        address: formData.get('address')?.toString() ?? '',
        coordinates: formData.get('coordinates')?.toString() || undefined,
        whatsappGroupLink: formData.get('whatsappGroupLink')?.toString() || undefined,
        lowStockThreshold: thresholdParsed,
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create location') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'updateLocation') {
    const locationId = formData.get('locationId')?.toString()?.trim() ?? '';
    const name = formData.get('name')?.toString()?.trim() ?? '';
    const address = formData.get('address')?.toString()?.trim() ?? '';
    const coordinatesRaw = formData.get('coordinates')?.toString()?.trim() ?? '';
    const whatsappRaw = formData.get('whatsappGroupLink')?.toString()?.trim() ?? '';
    const statusRaw = formData.get('status')?.toString();
    if (!locationId) {
      return json({ error: 'Location is required.' }, { status: 400 });
    }
    if (!name || !address) {
      return json({ error: 'Name and address are required.' }, { status: 400 });
    }
    const body: Record<string, unknown> = {
      locationId,
      name,
      address,
      coordinates: coordinatesRaw,
    };
    if (statusRaw === 'ACTIVE' || statusRaw === 'INACTIVE') {
      body.status = statusRaw;
    }
    if (whatsappRaw) {
      body.whatsappGroupLink = whatsappRaw;
    } else {
      body.whatsappGroupLink = null;
    }
    const thresholdRaw = formData.get('lowStockThreshold')?.toString().trim();
    if (thresholdRaw !== undefined) {
      if (thresholdRaw === '') {
        body.lowStockThreshold = null;
      } else {
        const parsed = Number.parseInt(thresholdRaw, 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
          return json({ error: 'Low-stock threshold must be a positive whole number.' }, { status: 400 });
        }
        body.lowStockThreshold = parsed;
      }
    }
    const res = await apiRequest<unknown>('/trpc/logistics.updateLocation', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to update location') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'deleteProvider') {
    const providerId = formData.get('providerId')?.toString()?.trim() ?? '';
    if (!providerId) return json({ error: 'Provider ID is required.' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/logistics.deleteProvider', {
      method: 'POST',
      cookie,
      body: { providerId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to delete logistics company') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'deleteLocation') {
    const locationId = formData.get('locationId')?.toString()?.trim() ?? '';
    if (!locationId) return json({ error: 'Location ID is required.' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/logistics.deleteLocation', {
      method: 'POST',
      cookie,
      body: { locationId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to delete location') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'importProvider') {
    // Per-row submit from /admin/logistics/partners/import-providers. Each
    // row is one POST that calls `logistics.createProvider` so the same
    // permission gate, RLS, and audit triggers apply per provider.
    const rowIndexRaw = formData.get('rowIndex')?.toString() ?? '';
    const rowIndex = Number.parseInt(rowIndexRaw, 10);
    const name = formData.get('name')?.toString().trim() ?? '';
    const contactInfo = formData.get('contactInfo')?.toString().trim() ?? '';
    const coverageArea = formData.get('coverageArea')?.toString().trim() ?? '';
    if (!name || !contactInfo || !coverageArea) {
      return json(
        { error: 'name, contact info, and coverage area are required.', rowIndex },
        { status: 400 },
      );
    }
    const res = await apiRequest<unknown>('/trpc/logistics.createProvider', {
      method: 'POST',
      cookie,
      body: { name, contactInfo, coverageArea },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to create logistics company'), rowIndex },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, rowIndex });
  }

  if (intent === 'importLocation') {
    // Per-row submit from /admin/logistics/partners/import-locations. The
    // editor resolves the provider name → providerId before posting, so this
    // handler only sees the resolved UUID.
    const rowIndexRaw = formData.get('rowIndex')?.toString() ?? '';
    const rowIndex = Number.parseInt(rowIndexRaw, 10);
    const providerId = formData.get('providerId')?.toString().trim() ?? '';
    const name = formData.get('name')?.toString().trim() ?? '';
    const address = formData.get('address')?.toString().trim() ?? '';
    const coordinates = formData.get('coordinates')?.toString().trim() ?? '';
    const whatsappGroupLink = formData.get('whatsappGroupLink')?.toString().trim() ?? '';
    if (!providerId || !name || !address) {
      return json(
        { error: 'provider, name, and address are required.', rowIndex },
        { status: 400 },
      );
    }
    const body: Record<string, unknown> = { providerId, name, address };
    if (coordinates) body.coordinates = coordinates;
    if (whatsappGroupLink) body.whatsappGroupLink = whatsappGroupLink;
    const res = await apiRequest<unknown>('/trpc/logistics.createLocation', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to create location'), rowIndex },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, rowIndex });
  }

  if (intent === 'importCombined') {
    // Combined provider + location import. Each row carries provider details +
    // location details. The server find-or-creates the provider, then creates
    // the location under it — idempotent on provider name.
    const rowIndexRaw = formData.get('rowIndex')?.toString() ?? '';
    const rowIndex = Number.parseInt(rowIndexRaw, 10);
    const providerName = formData.get('providerName')?.toString().trim() ?? '';
    const contactPhone = formData.get('contactPhone')?.toString().trim() ?? '';
    const coverageArea = formData.get('coverageArea')?.toString().trim() ?? '';
    const locationName = formData.get('locationName')?.toString().trim() ?? '';
    const locationAddress = formData.get('locationAddress')?.toString().trim() ?? '';
    const state = formData.get('state')?.toString().trim() ?? '';
    const whatsappGroupLink = formData.get('whatsappGroupLink')?.toString().trim() ?? '';
    const existingProviderId = formData.get('existingProviderId')?.toString().trim() ?? '';

    if (!providerName || !contactPhone || !coverageArea || !locationName || !locationAddress) {
      return json(
        { error: 'Provider name, contact phone, coverage area, location name, and address are required.', rowIndex },
        { status: 400 },
      );
    }

    let providerId = existingProviderId;

    // Step 1: Find or create the provider.
    // Always search by name first (even when client didn't resolve an ID) so
    // that sequential rows sharing a new provider name reuse the provider
    // created by the first row instead of trying to create a duplicate.
    if (!providerId) {
      const searchInput = JSON.stringify({ search: providerName, page: 1, limit: 50, kind: 'THIRD_PARTY' });
      const searchRes = await apiRequest<unknown>(
        `/trpc/logistics.listProviders?input=${encodeURIComponent(searchInput)}`,
        { method: 'GET', cookie },
      );
      if (searchRes.ok) {
        const providers =
          (searchRes.data as { result?: { data?: { providers: Array<{ id: string; name: string }> } } })
            ?.result?.data?.providers ?? [];
        const match = providers.find((p) => p.name.trim().toLowerCase() === providerName.trim().toLowerCase());
        if (match) providerId = match.id;
      }
    }

    if (!providerId) {
      // Create the provider
      const createRes = await apiRequest<unknown>('/trpc/logistics.createProvider', {
        method: 'POST',
        cookie,
        body: { name: providerName, contactInfo: contactPhone, coverageArea },
      });

      if (createRes.ok) {
        // tRPC mutation response: { result: { data: { ...provider } } }
        const created = (createRes.data as { result?: { data?: { id: string } } })?.result?.data;
        if (created?.id) {
          providerId = created.id;
        }
      }

      // If create failed (e.g. duplicate race) or ID parsing failed, retry search
      if (!providerId) {
        const retryInput = JSON.stringify({ search: providerName, page: 1, limit: 50, kind: 'THIRD_PARTY' });
        const retryRes = await apiRequest<unknown>(
          `/trpc/logistics.listProviders?input=${encodeURIComponent(retryInput)}`,
          { method: 'GET', cookie },
        );
        if (retryRes.ok) {
          const providers =
            (retryRes.data as { result?: { data?: { providers: Array<{ id: string; name: string }> } } })
              ?.result?.data?.providers ?? [];
          const match = providers.find((p) => p.name.trim().toLowerCase() === providerName.trim().toLowerCase());
          if (match) providerId = match.id;
        }
      }

      if (!providerId) {
        return json(
          { error: `Could not create or find provider "${providerName}".`, rowIndex },
          { status: 500 },
        );
      }
    }

    // Step 2: Find or create the location under the provider.
    // Idempotency key = (providerId, locationName) — case-insensitive.
    const locSearchInput = JSON.stringify({ providerId, page: 1, limit: 100 });
    const locSearchRes = await apiRequest<unknown>(
      `/trpc/logistics.listLocations?input=${encodeURIComponent(locSearchInput)}`,
      { method: 'GET', cookie },
    );
    let existingLocationId: string | null = null;
    if (locSearchRes.ok) {
      const locations =
        (locSearchRes.data as { result?: { data?: { locations: Array<{ id: string; name: string }> } } })
          ?.result?.data?.locations ?? [];
      const match = locations.find(
        (loc) => loc.name.trim().toLowerCase() === locationName.trim().toLowerCase(),
      );
      if (match) existingLocationId = match.id;
    }

    if (existingLocationId) {
      // Update the existing location (address, whatsapp link may have changed)
      // Append state to address so the client-side state filter picks it up
      const effectiveAddress = state && !locationAddress.toLowerCase().includes(state.toLowerCase())
        ? `${locationAddress}, ${state}`
        : locationAddress;
      const updateBody: Record<string, unknown> = {
        locationId: existingLocationId,
        name: locationName,
        address: effectiveAddress,
      };
      if (whatsappGroupLink) {
        updateBody.whatsappGroupLink = whatsappGroupLink;
      }
      const updateRes = await apiRequest<unknown>('/trpc/logistics.updateLocation', {
        method: 'POST',
        cookie,
        body: updateBody,
      });
      if (!updateRes.ok) {
        return json(
          { error: extractApiErrorMessage(updateRes.data, 'Failed to update location'), rowIndex },
          { status: safeStatus(updateRes.status) },
        );
      }
      return json({ success: true, rowIndex, updated: true });
    }

    // Create new location — append state to address for state-filter detection
    const newEffectiveAddress = state && !locationAddress.toLowerCase().includes(state.toLowerCase())
      ? `${locationAddress}, ${state}`
      : locationAddress;
    const locBody: Record<string, unknown> = {
      providerId,
      name: locationName,
      address: newEffectiveAddress,
    };
    if (whatsappGroupLink) locBody.whatsappGroupLink = whatsappGroupLink;

    const locRes = await apiRequest<unknown>('/trpc/logistics.createLocation', {
      method: 'POST',
      cookie,
      body: locBody,
    });
    if (!locRes.ok) {
      return json(
        { error: extractApiErrorMessage(locRes.data, 'Failed to create location'), rowIndex },
        { status: safeStatus(locRes.status) },
      );
    }
    return json({ success: true, rowIndex });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function LogisticsPartnersRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<LogisticsPartnersLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => <LogisticsPage {...data} />}
    </CachedAwait>
  );
}
