import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { TransfersPage } from '~/features/transfers/TransfersPage';
import type { TransfersStreamData } from '~/features/transfers/types';
import { loadTransfersRouteData, transfersRouteAction } from '~/lib/admin-transfers-route.server';
import { TransfersLoadingShell } from '~/features/logistics/LogisticsDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Stock Transfers — Yannis EOSE' }];

export async function loader(args: LoaderFunctionArgs) {
  return loadTransfersRouteData(args);
}

export const action = transfersRouteAction;

export default function TransfersRoute() {
  const { transfersShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<TransfersLoadingShell filters={transfersShell.filters} />}>
      {(data) => <TransfersPage {...(data as TransfersStreamData)} transfersPageVariant="stock" />}
    </CachedAwait>
  );
}
