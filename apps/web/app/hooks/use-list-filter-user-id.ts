import { useRouteLoaderData } from '@remix-run/react';

/**
 * Current staff user id from the nearest parent layout (`admin` / `hr` / `tpl` / `rider`).
 * Used to key localStorage filter snapshots per user.
 */
export function useListFilterUserId(): string | undefined {
  const admin = useRouteLoaderData('routes/admin') as { user?: { id: string } } | undefined;
  if (admin?.user?.id) return admin.user.id;
  const hr = useRouteLoaderData('routes/hr') as { user?: { id: string } } | undefined;
  if (hr?.user?.id) return hr.user.id;
  const tpl = useRouteLoaderData('routes/tpl') as { user?: { id: string } } | undefined;
  if (tpl?.user?.id) return tpl.user.id;
  const rider = useRouteLoaderData('routes/rider') as { user?: { id: string } } | undefined;
  return rider?.user?.id;
}
