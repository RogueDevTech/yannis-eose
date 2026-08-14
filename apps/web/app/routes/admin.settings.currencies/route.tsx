import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { requirePermission } from '~/lib/api.server';
import { CurrenciesSettingsPage } from '~/features/settings/CurrenciesSettingsPage';
import { loadCurrenciesPageData, handleCurrenciesForm } from '~/lib/currencies.server';

export const meta: MetaFunction = () => [{ title: 'Country & Currency — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'settings.currencies.view');
  return json(await loadCurrenciesPageData(request));
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'settings.currencies.manage');
  const formData = await request.formData();
  return handleCurrenciesForm(request, formData);
}

export default function CurrenciesSettingsRoute() {
  const data = useLoaderData<typeof loader>();
  return <CurrenciesSettingsPage currencies={data.currencies} />;
}
