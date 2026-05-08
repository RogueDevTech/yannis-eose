import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { Await, useLoaderData } from '@remix-run/react';
import { TransfersPage } from '~/features/transfers/TransfersPage';
import type { TransfersStreamData } from '~/features/transfers/types';
import { loadTransfersRouteData, transfersRouteAction } from '~/lib/admin-transfers-route.server';
import { LogisticsTransfersLoadingShell } from '~/features/logistics/LogisticsDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Partner Stock Transfers — Yannis EOSE' }];

export async function loader(args: LoaderFunctionArgs) {
  return loadTransfersRouteData(args);
}

export const action = transfersRouteAction;

export default function LogisticsTransfersRoute() {
  const { transfersShell, pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<LogisticsTransfersLoadingShell filters={transfersShell.filters} />}>
      <Await resolve={pageData}>
        {(data) => <TransfersPage {...(data as TransfersStreamData)} transfersPageVariant="logistics" />}
      </Await>
    </Suspense>
  );
}
