import { redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';

export const meta: MetaFunction = () => [
  { title: 'Reconciliation — Yannis EOSE' },
];

export async function loader(_args: LoaderFunctionArgs) {
  return redirect('/admin/inventory');
}

export async function action(_args: ActionFunctionArgs) {
  return redirect('/admin/inventory');
}
