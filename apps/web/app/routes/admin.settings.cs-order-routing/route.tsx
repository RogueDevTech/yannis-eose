import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { requirePermission } from '~/lib/api.server';
import { CsOrderRoutingSettingsPage } from '~/features/settings/CsOrderRoutingSettingsPage';
import {
  handleCsOrderRoutingFormJson,
  loadCsOrderRoutingPageData,
} from '~/lib/cs-order-routing.server';

export const meta: MetaFunction = () => [{ title: 'CS routing — which branch? — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'orders.routing');
  return json(await loadCsOrderRoutingPageData(request, user));
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'orders.routing');
  const formData = await request.formData();
  return handleCsOrderRoutingFormJson(request, formData);
}

export default function CsOrderRoutingRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <CsOrderRoutingSettingsPage
      key={data.relationshipMode}
      branches={data.branches}
      products={data.products}
      teamsByBranchId={data.teamsByBranchId}
      rules={data.rules}
      relationshipMode={data.relationshipMode}
    />
  );
}
