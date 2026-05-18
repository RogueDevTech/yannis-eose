import { redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';

const TARGET = '/admin/shipments/receive';

export async function loader(_args: LoaderFunctionArgs) {
  return redirect(TARGET, 308);
}

export async function action(_args: ActionFunctionArgs) {
  return redirect(TARGET, 308);
}

export default function LegacyInventoryShipmentReceiveRoute() {
  return null;
}

