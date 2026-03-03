import { useState } from 'react';
import { Link } from '@remix-run/react';
import type { Product } from './types';
import { PRODUCT_STATUS_COLORS } from './types';

interface ProductsListPageProps {
  products: Product[];
  total: number;
}

function formatPriceRange(product: Product): string {
  const offers = product.offers ?? [];
  if (offers.length === 0) {
    return `\u20A6${Number(product.baseSalePrice).toLocaleString()}`;
  }
  const prices = offers.map((o) => parseFloat(o.price)).filter((p) => !isNaN(p)).sort((a, b) => a - b);
  if (prices.length === 0) {
    return `\u20A6${Number(product.baseSalePrice).toLocaleString()}`;
  }
  if (prices.length === 1 || prices[0] === prices[prices.length - 1]) {
    return `\u20A6${prices[0].toLocaleString()}`;
  }
  return `\u20A6${prices[0].toLocaleString()} \u2013 \u20A6${prices[prices.length - 1].toLocaleString()}`;
}

export function ProductsListPage({ products, total }: ProductsListPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const filteredProducts = products.filter((product) => {
    if (statusFilter !== 'ALL' && product.status !== statusFilter) return false;
    if (
      searchQuery &&
      !product.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Products</h1>
          <p className="text-sm text-surface-800 dark:text-surface-400 mt-0.5">
            Manage your product catalog and bundle offers
          </p>
        </div>
        <Link to="/admin/products/new" className="btn-primary">
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Product
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Total Products</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{total}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Active</p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">
            {products.filter((p) => p.status === 'ACTIVE').length}
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Categories</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">
            {new Set(products.map((p) => p.category).filter(Boolean)).size}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10 py-1.5"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input w-full sm:w-40 py-1.5"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
      </div>

      {/* Products table */}
      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Product</th>
                <th className="table-header">Category</th>
                <th className="table-header text-center">Offers</th>
                <th className="table-header text-right">Price Range</th>
                <th className="table-header text-right">Cost Price</th>
                <th className="table-header">Status</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id} className="table-row">
                  <td className="table-cell">
                    <div>
                      <p className="font-medium text-surface-900 dark:text-surface-100">{product.name}</p>
                      {product.description && (
                        <p className="text-xs text-surface-700 dark:text-surface-500 truncate max-w-[200px]">
                          {product.description}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="table-cell text-surface-800 dark:text-surface-400">
                    {product.category ?? '\u2014'}
                  </td>
                  <td className="table-cell text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300">
                      {(product.offers ?? []).length} tier{(product.offers ?? []).length !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td className="table-cell text-right font-medium">
                    {formatPriceRange(product)}
                  </td>
                  <td className="table-cell text-right font-medium">
                    {product.costPrice ? `\u20A6${Number(product.costPrice).toLocaleString()}` : '\u2014'}
                  </td>
                  <td className="table-cell">
                    <span className={PRODUCT_STATUS_COLORS[product.status] ?? 'badge'}>
                      {product.status}
                    </span>
                  </td>
                  <td className="table-cell text-right">
                    <Link
                      to={`/admin/products/${product.id}`}
                      className="text-brand-500 hover:text-brand-600 text-sm font-medium"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-surface-700 dark:text-surface-500">
                    {products.length === 0 ? 'No products yet. Add your first product.' : 'No matching products found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
          {filteredProducts.map((product) => (
            <Link
              key={product.id}
              to={`/admin/products/${product.id}`}
              className="block p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-medium text-surface-900 dark:text-surface-100">{product.name}</span>
                <span className={PRODUCT_STATUS_COLORS[product.status] ?? 'badge'}>{product.status}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-surface-800 dark:text-surface-400">
                  {(product.offers ?? []).length} offer{(product.offers ?? []).length !== 1 ? 's' : ''}
                </span>
                <span className="font-medium text-surface-900 dark:text-surface-100">
                  {formatPriceRange(product)}
                </span>
              </div>
              {product.category && (
                <p className="text-xs text-surface-700 dark:text-surface-500 mt-1">{product.category}</p>
              )}
            </Link>
          ))}
          {filteredProducts.length === 0 && (
            <div className="p-8 text-center text-surface-700 dark:text-surface-500">
              {products.length === 0 ? 'No products yet' : 'No matching products found'}
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-surface-800 dark:text-surface-400">
          Showing {filteredProducts.length} of {total} products
        </p>
      </div>
    </div>
  );
}
