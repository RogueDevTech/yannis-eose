import { redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';

function targetPath(id: string | undefined): string {
  return id ? `/admin/shipments/${id}` : '/admin/shipments';
}

export async function loader({ params }: LoaderFunctionArgs) {
  return redirect(targetPath(params['id']), 308);
}

export async function action({ params }: ActionFunctionArgs) {
  return redirect(targetPath(params['id']), 308);
}

export default function LegacyInventoryShipmentDetailRoute() {
  return null;
}
