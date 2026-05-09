import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { TransfersPage } from '~/features/transfers/TransfersPage';
import type { TransfersStreamData } from '~/features/transfers/types';
import { loadTransfersRouteData, transfersRouteAction } from '~/lib/admin-transfers-route.server';
import { LogisticsTransfersLoadingShell } from '~/features/logistics/LogisticsDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Partner Stock Transfers — Yannis EOSE' }];

export async function loader(args: LoaderFunctionArgs) {
  return loadTransfersRouteData(args);
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export const action = transfersRouteAction;

export default function LogisticsTransfersRoute() {
  const { transfersShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<LogisticsTransfersLoadingShell filters={transfersShell.filters} />}
      loaderShell={{ transfersShell }}
      deferredKey="pageData"
    >
      {(data) => <TransfersPage {...(data as TransfersStreamData)} transfersPageVariant="logistics" />}
    </CachedAwait>
  );
}
