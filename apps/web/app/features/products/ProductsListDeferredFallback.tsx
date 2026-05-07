import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import type { Product } from './types';

const skeletonColumns: CompactTableColumn<Product>[] = [
  { key: 'product', header: 'Product', minWidth: 'min-w-[200px]', render: () => null },
  { key: 'category', header: 'Category', render: () => null },
  { key: 'baseSalePrice', header: 'Base Price', align: 'right', headerClassName: 'text-right', render: () => null },
  { key: 'offers', header: 'Offers', render: () => null },
  { key: 'status', header: 'Status', render: () => null },
  { key: 'actions', header: '', mobileLabel: 'Actions', align: 'right', headerClassName: 'text-right', tight: true, render: () => null },
];

/**
 * Layout-matched fallback while `products.list` streams on `/admin/products` (product tab).
 */
export function ProductsListDeferredFallback() {
  return (
    <div className="space-y-4">
      <div className="card p-0 overflow-hidden">
        <div className="flex flex-col gap-2 p-3 md:flex-row md:flex-nowrap md:items-center md:gap-3">
          <div className="h-10 min-w-0 flex-1 rounded-md border border-app-border bg-app-hover animate-pulse" aria-hidden />
          <div className="hidden h-9 w-full shrink-0 rounded-md border border-app-border bg-app-hover animate-pulse sm:w-40 md:block" aria-hidden />
        </div>
      </div>

      <CompactTable<Product>
        columns={skeletonColumns}
        rows={[]}
        rowKey={(p) => p.id}
        loading
        loadingVariant="overlay"
        withCard
        emptyTitle="Loading products…"
        emptyDescription="Catalog data is streaming in."
        pagination={{
          page: 1,
          totalPages: 1,
          onPageChange: () => {},
          showWhenSinglePage: false,
          summary: <span className="inline-block h-4 w-48 rounded bg-app-hover animate-pulse" aria-hidden />,
          wrapperClassName: 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 pb-3 pt-1',
        }}
      />
    </div>
  );
}
