import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { requirePermission } from '~/lib/api.server';
import { ImportJobDetailPage } from '~/features/orders/ImportJobDetailPage';

export const meta: MetaFunction = () => [
  { title: 'Import status — Yannis EOSE' },
];

/**
 * Dedicated status page for a single import job: `/admin/data/import/:jobId`.
 * The trailing `_` on `import` keeps this OUT of the import landing route's
 * nesting so it renders as its own full page. The job data itself is loaded
 * client-side (browser tRPC + polling) — the loader only gates the permission
 * and hands the id through.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, 'data.import');
  const jobId = params['jobId'];
  if (!jobId) {
    throw new Response('Not found', { status: 404 });
  }
  return json({ jobId });
}

export default function ImportJobDetailRoute() {
  const { jobId } = useLoaderData<typeof loader>();
  return <ImportJobDetailPage jobId={jobId} backHref="/admin/data/import" />;
}
