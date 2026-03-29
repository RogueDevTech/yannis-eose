import { useState, useEffect, useRef } from 'react';
import { Form, useNavigation, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { PageNotification } from '~/components/ui/page-notification';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { SearchInput } from '~/components/ui/search-input';
import { EmptyState } from '~/components/ui/empty-state';

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
    <Modal open onClose={onClose} maxWidth="max-w-lg" contentClassName="p-0 max-h-[90dvh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
          <h3 className="text-lg font-semibold text-app-fg">
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

          <TextInput
            id="name"
            name="name"
            label="Category Name"
            required
            minLength={2}
            defaultValue={category?.name ?? ''}
            placeholder="e.g. Prosma"
          />

          <div>
            <TextInput
              id="brandName"
              name="brandName"
              label="Brand Name (shown on invoices)"
              required
              defaultValue={category?.brandName ?? ''}
              placeholder="e.g. Prosma"
            />
            <p className="text-xs text-app-fg-muted mt-1">
              All products under this category will carry this brand name.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextInput
              id="brandPhone"
              name="brandPhone"
              label="Brand Phone (invoices)"
              type="text"
              defaultValue={category?.brandPhone ?? ''}
              placeholder="+2348000000000"
            />
            <TextInput
              id="brandEmail"
              name="brandEmail"
              label="Brand Email (invoices)"
              type="email"
              defaultValue={category?.brandEmail ?? ''}
              placeholder="brand@company.com"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <TextInput
                id="brandWhatsapp"
                name="brandWhatsapp"
                label="Brand WhatsApp Number"
                type="text"
                defaultValue={category?.brandWhatsapp ?? ''}
                placeholder="+2348000000000"
                hint="For automatic messaging."
              />
            </div>
            <div>
              <TextInput
                id="smsSenderId"
                name="smsSenderId"
                label="SMS Sender ID"
                type="text"
                defaultValue={category?.smsSenderId ?? ''}
                placeholder="e.g. Prosma"
                hint="Used as sender ID when sending SMS to customers."
              />
            </div>
          </div>

          {isEdit && (
            <FormSelect
              id="status"
              name="status"
              label="Status"
              defaultValue={category.status}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
                { value: 'ARCHIVED', label: 'Archived' },
              ]}
            />
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-app-border">
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

      {showArchiveConfirm && category && (
        <ConfirmActionModal
          open={showArchiveConfirm}
          onClose={() => setShowArchiveConfirm(false)}
          title={`Archive "${category.name}"?`}
          description={<><strong>{category.name}</strong> will be hidden from default category lists.</>}
          details={
            <ul className="list-disc list-inside text-sm text-app-fg-muted space-y-1">
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
    </Modal>
  );
}

export function CategoriesPage({ categories, total, actionData }: CategoriesPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalCategory, setModalCategory] = useState<Category | null | undefined>(undefined); // undefined = closed
  const [dismissedError, setDismissedError] = useState(false);

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
  }, [actionData?.error]);
  const navigation = useNavigation();

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
      <PageHeader
        title="Product Categories"
        description="Manage brand categories for products. Brand info appears on invoices and SMS."
        actions={
          <Button variant="primary" className="flex items-center gap-2" onClick={() => setModalCategory(null)}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Category
          </Button>
        }
      />

      {actionData?.error && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionData.error}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      <OverviewStatStrip
        showScrollControls={false}
        items={[
          { label: 'Total Categories', value: total, valueClassName: 'text-app-fg' },
          { label: 'Active', value: activeCount, valueClassName: 'text-success-600 dark:text-success-400' },
        ]}
      />

      {/* Search */}
      <div className="card">
        <div className="flex items-center gap-2">
          <SearchInput
            value={search}
            onChange={updateSearch}
            placeholder="Search categories or brand names..."
            className="flex-1"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
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
                  <td colSpan={8}>
                    <EmptyState title="No categories found" description="Create one to get started." />
                  </td>
                </tr>
              )}
              {categories.map((cat, idx) => (
                <tr key={cat.id} className="table-row">
                  <td className="table-cell text-xs text-app-fg-muted">{idx + 1}</td>
                  <td className="table-cell font-medium text-app-fg">{cat.name}</td>
                  <td className="table-cell text-app-fg-muted">{cat.brandName}</td>
                  <td className="table-cell hidden md:table-cell text-xs text-app-fg-muted">
                    {cat.brandPhone && <div>{cat.brandPhone}</div>}
                    {cat.brandEmail && <div className="text-brand-500 dark:text-brand-400">{cat.brandEmail}</div>}
                    {!cat.brandPhone && !cat.brandEmail && '—'}
                  </td>
                  <td className="table-cell hidden lg:table-cell text-xs text-app-fg-muted">
                    {cat.brandWhatsapp || '—'}
                  </td>
                  <td className="table-cell hidden lg:table-cell text-xs text-app-fg-muted">
                    {cat.smsSenderId || '—'}
                  </td>
                  <td className="table-cell">
                    <StatusBadge status={cat.status} />
                  </td>
                  <td className="table-cell text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setModalCategory(cat)}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-3 px-1">
          {categories.length === 0 ? (
            <EmptyState title="No categories found" description="Create one to get started." />
          ) : (
            categories.map((cat) => (
              <div key={cat.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="font-medium text-app-fg">{cat.name}</p>
                    <p className="text-sm text-app-fg-muted">{cat.brandName}</p>
                  </div>
                  <StatusBadge status={cat.status} />
                </div>
                {(cat.brandPhone || cat.brandEmail || cat.brandWhatsapp || cat.smsSenderId) && (
                  <div className="text-sm text-app-fg-muted space-y-0.5 mb-2">
                    {cat.brandPhone && <div>Phone: {cat.brandPhone}</div>}
                    {cat.brandEmail && <div className="text-brand-500 dark:text-brand-400">{cat.brandEmail}</div>}
                    {cat.brandWhatsapp && <div>WhatsApp: {cat.brandWhatsapp}</div>}
                    {cat.smsSenderId && <div>Sender ID: {cat.smsSenderId}</div>}
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setModalCategory(cat)}
                >
                  Edit
                </Button>
              </div>
            ))
          )}
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
