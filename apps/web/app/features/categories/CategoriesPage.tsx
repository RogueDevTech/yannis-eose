import { useState, useEffect, useRef } from 'react';
import { Form, useNavigation, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Spinner } from '~/components/ui/spinner';

interface Category {
  id: string;
  name: string;
  brandName: string;
  brandPhone: string | null;
  brandEmail: string | null;
  brandWhatsapp: string | null;
  smsSenderId: string | null;
  status: string;
  createdAt: string;
}

interface CategoriesPageProps {
  categories: Category[];
  total: number;
  actionData?: { error?: string | null; success?: boolean } | null;
}

function CategoryModal({
  category,
  onClose,
}: {
  category: Category | null; // null = create mode
  onClose: () => void;
}) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const formWrapperRef = useRef<HTMLDivElement>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  // Close archive confirm modal on successful submission
  const prevNavState = useRef(navigation.state);
  useEffect(() => {
    if (prevNavState.current === 'submitting' && navigation.state === 'idle' && showArchiveConfirm) {
      setShowArchiveConfirm(false);
    }
    prevNavState.current = navigation.state;
  }, [navigation.state, showArchiveConfirm]);

  const isEdit = category !== null;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!isEdit || !category || category.status === 'ARCHIVED') return;
    const form = e.currentTarget;
    const statusSelect = form.querySelector<HTMLSelectElement>('[name="status"]');
    if (statusSelect?.value === 'ARCHIVED') {
      e.preventDefault();
      setShowArchiveConfirm(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-surface-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
            {isEdit ? 'Update Category' : 'New Category'}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-5 h-5 text-surface-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div ref={formWrapperRef}>
          <Form method="post" className="px-6 py-4 space-y-4" onSubmit={handleSubmit}>
          <input type="hidden" name="intent" value={isEdit ? 'update' : 'create'} />
          {isEdit && <input type="hidden" name="categoryId" value={category.id} />}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
              Category Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              minLength={2}
              defaultValue={category?.name ?? ''}
              className="input"
              placeholder="e.g. Prosma"
            />
          </div>

          <div>
            <label htmlFor="brandName" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
              Brand Name
              <span className="text-surface-700 dark:text-surface-300 font-normal ml-1">(shown on invoices)</span>
            </label>
            <input
              id="brandName"
              name="brandName"
              type="text"
              required
              defaultValue={category?.brandName ?? ''}
              className="input"
              placeholder="e.g. Prosma"
            />
            <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
              All products under this category will carry this brand name.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="brandPhone" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Brand Phone
                <span className="text-surface-700 dark:text-surface-300 font-normal ml-1">(invoices)</span>
              </label>
              <input
                id="brandPhone"
                name="brandPhone"
                type="text"
                defaultValue={category?.brandPhone ?? ''}
                className="input"
                placeholder="+2348000000000"
              />
            </div>
            <div>
              <label htmlFor="brandEmail" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Brand Email
                <span className="text-surface-700 dark:text-surface-300 font-normal ml-1">(invoices)</span>
              </label>
              <input
                id="brandEmail"
                name="brandEmail"
                type="email"
                defaultValue={category?.brandEmail ?? ''}
                className="input"
                placeholder="brand@company.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="brandWhatsapp" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Brand WhatsApp Number
              </label>
              <input
                id="brandWhatsapp"
                name="brandWhatsapp"
                type="text"
                defaultValue={category?.brandWhatsapp ?? ''}
                className="input"
                placeholder="+2348000000000"
              />
              <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                For automatic messaging.
              </p>
            </div>
            <div>
              <label htmlFor="smsSenderId" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                SMS Sender ID
              </label>
              <input
                id="smsSenderId"
                name="smsSenderId"
                type="text"
                defaultValue={category?.smsSenderId ?? ''}
                className="input"
                placeholder="e.g. Prosma"
              />
              <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                Used as sender ID when sending SMS to customers.
              </p>
            </div>
          </div>

          {isEdit && (
            <div>
              <label htmlFor="status" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Status
              </label>
              <select
                id="status"
                name="status"
                defaultValue={category.status}
                className="input"
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-200 dark:border-surface-700">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
              loadingText={isEdit ? 'Updating...' : 'Creating...'}
            >
              {isEdit ? 'Update' : 'Create Category'}
            </Button>
          </div>
        </Form>
        </div>
      </div>

      {showArchiveConfirm && category && (
        <ConfirmActionModal
          open={showArchiveConfirm}
          onClose={() => setShowArchiveConfirm(false)}
          title={`Archive "${category.name}"?`}
          description={<><strong>{category.name}</strong> will be hidden from default category lists.</>}
          details={
            <ul className="list-disc list-inside text-sm text-surface-600 dark:text-surface-400 space-y-1">
              <li>Hidden from default category lists</li>
              <li>You can change status back anytime</li>
            </ul>
          }
          confirmLabel="Archive"
          variant="archive"
          loading={isSubmitting}
          onConfirm={() => {
            formWrapperRef.current?.querySelector<HTMLFormElement>('form')?.requestSubmit();
          }}
        />
      )}
    </div>
  );
}

export function CategoriesPage({ categories, total, actionData }: CategoriesPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalCategory, setModalCategory] = useState<Category | null | undefined>(undefined); // undefined = closed
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';

  // Close modal on successful action
  useEffect(() => {
    if (actionData?.success && navigation.state === 'idle') {
      setModalCategory(undefined);
    }
  }, [actionData?.success, navigation.state]);

  const search = searchParams.get('search') || '';

  const updateSearch = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set('search', value);
    } else {
      params.delete('search');
    }
    setSearchParams(params);
  };

  const activeCount = categories.filter((c) => c.status === 'ACTIVE').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Product Categories</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-1">
            Manage brand categories for products. Brand info appears on invoices and SMS.
          </p>
        </div>
        <Button variant="primary" className="flex items-center gap-2" onClick={() => setModalCategory(null)}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Category
        </Button>
      </div>

      {actionData?.error && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionData.error}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200">Total Categories</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{total}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200">Active</p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">{activeCount}</p>
        </div>
      </div>

      {/* Search */}
      <div className="card">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search categories or brand names..."
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
            className="input text-sm flex-1"
          />
          {isFilterLoading && (
            <span className="flex items-center text-surface-500 dark:text-surface-400" aria-hidden>
              <Spinner size="sm" className="shrink-0" />
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">#</th>
                <th className="table-header">Category Name</th>
                <th className="table-header">Brand Name</th>
                <th className="table-header hidden md:table-cell">Brand Phone / Email</th>
                <th className="table-header hidden lg:table-cell">WhatsApp</th>
                <th className="table-header hidden lg:table-cell">Sender ID</th>
                <th className="table-header">Status</th>
                <th className="table-header text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-surface-800 dark:text-surface-200">
                    No categories found. Create one to get started.
                  </td>
                </tr>
              )}
              {categories.map((cat, idx) => (
                <tr key={cat.id} className="table-row">
                  <td className="table-cell text-xs text-surface-800 dark:text-surface-200">{idx + 1}</td>
                  <td className="table-cell font-medium text-surface-900 dark:text-white">{cat.name}</td>
                  <td className="table-cell text-surface-700 dark:text-surface-300">{cat.brandName}</td>
                  <td className="table-cell hidden md:table-cell text-xs text-surface-600 dark:text-surface-200">
                    {cat.brandPhone && <div>{cat.brandPhone}</div>}
                    {cat.brandEmail && <div className="text-brand-500 dark:text-brand-400">{cat.brandEmail}</div>}
                    {!cat.brandPhone && !cat.brandEmail && '—'}
                  </td>
                  <td className="table-cell hidden lg:table-cell text-xs text-surface-600 dark:text-surface-200">
                    {cat.brandWhatsapp || '—'}
                  </td>
                  <td className="table-cell hidden lg:table-cell text-xs text-surface-600 dark:text-surface-200">
                    {cat.smsSenderId || '—'}
                  </td>
                  <td className="table-cell">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                      cat.status === 'ACTIVE'
                        ? 'bg-success-50 dark:bg-success-700/20 text-success-700 dark:text-success-400'
                        : 'bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200'
                    }`}>
                      {cat.status === 'ACTIVE' ? 'Active' : cat.status === 'INACTIVE' ? 'Inactive' : 'Archived'}
                    </span>
                  </td>
                  <td className="table-cell text-right">
                    <button
                      onClick={() => setModalCategory(cat)}
                      className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 text-sm font-medium"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {modalCategory !== undefined && (
        <CategoryModal
          category={modalCategory}
          onClose={() => setModalCategory(undefined)}
        />
      )}
    </div>
  );
}
