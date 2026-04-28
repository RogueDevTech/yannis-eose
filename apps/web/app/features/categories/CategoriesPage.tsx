import { useState, useEffect, useRef, useMemo } from 'react';
import { Form, useNavigation, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { DataTable, type TableColumn } from '~/components/ui/data-table';
import { DescriptionList } from '~/components/ui/description-list';
import { Modal } from '~/components/ui/modal';
import { PageNotification } from '~/components/ui/page-notification';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { SearchInput } from '~/components/ui/search-input';

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

function CategoryViewModal({
  category,
  onClose,
  onEdit,
}: {
  category: Category;
  onClose: () => void;
  onEdit: () => void;
}) {
  const created = new Date(category.createdAt).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" aria-labelledby="category-view-title">
      <div className="card border-0 shadow-none space-y-4 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <h3 id="category-view-title" className="text-lg font-semibold text-app-fg">
            Category details
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-app-fg-muted hover:text-app-fg shrink-0 p-1 rounded-lg hover:bg-app-hover"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <DescriptionList
          divided
          items={[
            { label: 'Category name', value: category.name },
            { label: 'Brand name', value: category.brandName },
            { label: 'Brand phone', value: category.brandPhone, hideIfEmpty: true },
            { label: 'Brand email', value: category.brandEmail, hideIfEmpty: true },
            { label: 'Brand WhatsApp', value: category.brandWhatsapp, hideIfEmpty: true },
            { label: 'SMS sender ID', value: category.smsSenderId, hideIfEmpty: true },
            {
              label: 'Status',
              value: <StatusBadge status={category.status} />,
            },
            { label: 'Created', value: created },
          ]}
        />
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-app-border">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onClose();
              onEdit();
            }}
          >
            Edit
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CategoriesPage({ categories, total, actionData }: CategoriesPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalCategory, setModalCategory] = useState<Category | null | undefined>(undefined); // undefined = closed
  const [viewCategory, setViewCategory] = useState<Category | null>(null);
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

  const columns: TableColumn<Category>[] = useMemo(
    () => [
      {
        key: 'idx',
        header: '#',
        className: 'w-[1%] whitespace-nowrap',
        render: (_row, i) => <span className="text-xs text-app-fg-muted tabular-nums">{i + 1}</span>,
      },
      {
        key: 'name',
        header: 'Category name',
        render: (cat) => <span className="font-medium text-app-fg">{cat.name}</span>,
        minWidth: 'min-w-[120px]',
      },
      {
        key: 'brand',
        header: 'Brand name',
        render: (cat) => <span className="text-app-fg-muted">{cat.brandName}</span>,
        minWidth: 'min-w-[100px]',
      },
      {
        key: 'contact',
        header: 'Brand phone / email',
        className: 'hidden md:table-cell',
        render: (cat) => (
          <div className="text-xs text-app-fg-muted space-y-0.5">
            {cat.brandPhone ? <div>{cat.brandPhone}</div> : null}
            {cat.brandEmail ? (
              <div className="text-brand-500 dark:text-brand-400 break-all">{cat.brandEmail}</div>
            ) : null}
            {!cat.brandPhone && !cat.brandEmail ? <span>—</span> : null}
          </div>
        ),
      },
      {
        key: 'contactMobile',
        header: 'Contact',
        className: 'md:hidden',
        render: (cat) => (
          <div className="text-xs text-app-fg-muted space-y-0.5">
            {cat.brandPhone ? <div>{cat.brandPhone}</div> : null}
            {cat.brandEmail ? (
              <div className="text-brand-500 dark:text-brand-400 break-all">{cat.brandEmail}</div>
            ) : null}
            {cat.brandWhatsapp ? <div>WA: {cat.brandWhatsapp}</div> : null}
            {cat.smsSenderId ? <div>SMS: {cat.smsSenderId}</div> : null}
            {!cat.brandPhone && !cat.brandEmail && !cat.brandWhatsapp && !cat.smsSenderId ? <span>—</span> : null}
          </div>
        ),
      },
      {
        key: 'whatsapp',
        header: 'WhatsApp',
        className: 'hidden lg:table-cell',
        render: (cat) => <span className="text-xs text-app-fg-muted">{cat.brandWhatsapp || '—'}</span>,
      },
      {
        key: 'sender',
        header: 'Sender ID',
        className: 'hidden lg:table-cell',
        render: (cat) => <span className="text-xs text-app-fg-muted">{cat.smsSenderId || '—'}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        render: (cat) => <StatusBadge status={cat.status} />,
      },
      {
        key: 'actions',
        header: <span className="sr-only">Actions</span>,
        align: 'right',
        className: 'w-[1%] whitespace-nowrap',
        render: (cat) => (
          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setViewCategory(cat);
              }}
            >
              View
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setModalCategory(cat);
              }}
            >
              Edit
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  useEffect(() => {
    if (!viewCategory) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewCategory(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewCategory]);

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

      <div className="card p-4 sm:p-6">
        <DataTable
          caption="Product categories"
          columns={columns}
          data={categories}
          keyField="id"
          emptyTitle="No categories found"
          emptyDescription="Create one to get started."
          emptyAction={
            <Button type="button" variant="primary" onClick={() => setModalCategory(null)}>
              New category
            </Button>
          }
        />
      </div>

      {viewCategory && (
        <CategoryViewModal
          category={viewCategory}
          onClose={() => setViewCategory(null)}
          onEdit={() => {
            setModalCategory(viewCategory);
            setViewCategory(null);
          }}
        />
      )}

      {modalCategory !== undefined && (
        <CategoryModal
          category={modalCategory}
          onClose={() => setModalCategory(undefined)}
        />
      )}
    </div>
  );
}
