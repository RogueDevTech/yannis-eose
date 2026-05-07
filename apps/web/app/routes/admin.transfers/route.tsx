import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { TransfersPage } from '~/features/transfers/TransfersPage';
import type { TransfersStreamData } from '~/features/transfers/types';
import { loadTransfersRouteData, transfersRouteAction } from '~/lib/admin-transfers-route.server';

export const meta: MetaFunction = () => [{ title: 'Stock Transfers — Yannis EOSE' }];

export async function loader(args: LoaderFunctionArgs) {
  return loadTransfersRouteData(args);
}

export const action = transfersRouteAction;

export default function TransfersRoute() {
  const data = useLoaderData<typeof loader>() as TransfersStreamData;
  return (
    <>
      <TransfersPage {...data} transfersPageVariant="stock" />
    </>
  );
}
