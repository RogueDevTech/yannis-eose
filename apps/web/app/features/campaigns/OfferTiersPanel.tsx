import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher, useRevalidator } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { FormField } from '~/components/ui/form-field';
import { FormSelect } from '~/components/ui/form-select';
import { AmountInput } from '~/components/ui/amount-input';
import { CompactTable } from '~/components/ui/compact-table';
import { StatusBadge } from '~/components/ui/status-badge';
import { TableActionButton } from '~/components/ui/table-action-button';
import { NairaPrice } from '~/components/ui/naira-price';
import type { FileUploadUploadState } from '~/components/ui/file-upload';
import { OfferImagesEditor } from '~/features/products/OfferImagesEditor';
import type { MinimalOfferTemplateForPreview } from './offer-template-preview';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';

export interface OfferTiersPanelProps {
  /** Catalog SKU — tiers attach here but are managed from this form, not the product page. */
  productId: string | null;
  templates: MinimalOfferTemplateForPreview[];
  canManage: boolean;
  readOnly?: boolean;
  /** When this nonce increases and `productId` is set, open the “new tier” modal once (e.g. header Create offer). */
  openCreateTierNonce?: number;
  onOpenCreateTierDispatched?: () => void;
  /** After templates load, open edit once for this tier id (e.g. Offers hub table → Edit). */
  editTierKick?: { templateId: string; nonce: number } | null;
  onEditTierKickDispatched?: () => void;
  /** After tier mutations, refresh client-loaded templates (create form) or rely on `revalidate` (edit). */
  onTemplatesChanged?: () => void;
}

export function OfferTiersPanel({
  productId,
  templates,
  canManage,
  readOnly,
  openCreateTierNonce,
  onOpenCreateTierDispatched,
  editTierKick,
  onEditTierKickDispatched,
  onTemplatesChanged,
}: OfferTiersPanelProps) {
  const { revalidate } = useRevalidator();
  const { toast } = useToast();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const fetcherSurface = useFetcherActionSurface(fetcher);

  const archiveFetcher = useFetcher<{ success?: boolean; error?: string; archivedCount?: number }>();
  const archiveSurface = useFetcherActionSurface(archiveFetcher);
  const prevArchiveData = useRef(archiveFetcher.data);
  const [showArchiveAllConfirm, setShowArchiveAllConfirm] = useState(false);

  const hasArchivableTiers = templates.some((t) => {
    const s = t.status?.toUpperCase();
    return s === 'ACTIVE' || s === 'INACTIVE';
  });

  const bumpTemplates = useCallback(() => {
    onTemplatesChanged?.();
    revalidate();
  }, [onTemplatesChanged, revalidate]);

  useEffect(() => {
    if (archiveFetcher.data === prevArchiveData.current) return;
    prevArchiveData.current = archiveFetcher.data;
    const d = archiveFetcher.data;
    if (!d || typeof d !== 'object') return;
    if (d.success) {
      if (d.archivedCount === 0) {
        toast.success('No active or inactive tiers to archive.');
      } else if (typeof d.archivedCount === 'number' && d.archivedCount > 0) {
        toast.success(
          `Archived ${d.archivedCount} tier(s). Add new active tiers for Edge forms; until then, forms fall back to catalog list price.`,
        );
      } else {
        toast.success(
          'Offer tiers archived. Add new active tiers for Edge forms; until then, forms fall back to catalog list price.',
        );
      }
      setShowArchiveAllConfirm(false);
      bumpTemplates();
    } else if (d.error) {
      if (!showArchiveAllConfirm) toast.error('Error', d.error);
    }
  }, [archiveFetcher.data, toast, bumpTemplates, showArchiveAllConfirm]);

  const [showModal, setShowModal] = useState(false);
  const [uploadState, setUploadState] = useState<FileUploadUploadState>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [statusDraft, setStatusDraft] = useState<'ACTIVE' | 'INACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [viewingTier, setViewingTier] = useState<MinimalOfferTemplateForPreview | null>(null);

  useFetcherToast(fetcher.data, {
    successMessage: 'Offer tier saved',
    skipErrorToast: showModal,
  });

  const lastOpenedCreateNonce = useRef(0);
  const lastEditTierNonce = useRef(0);

  const busy = fetcher.state !== 'idle';

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data && (fetcher.data as { success?: boolean }).success) {
      setShowModal(false);
      setEditingId(null);
      setName('');
      setQty('1');
      setPrice('');
      setImageUrls([]);
      setStatusDraft('ACTIVE');
      bumpTemplates();
    }
  }, [fetcher.state, fetcher.data, bumpTemplates]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setName('');
    setQty('1');
    setPrice('');
    setImageUrls([]);
    setStatusDraft('ACTIVE');
    setShowModal(true);
  }, []);

  useEffect(() => {
    if (!productId || openCreateTierNonce == null || openCreateTierNonce <= lastOpenedCreateNonce.current) return;
    lastOpenedCreateNonce.current = openCreateTierNonce;
    openCreate();
    onOpenCreateTierDispatched?.();
  }, [productId, openCreateTierNonce, openCreate, onOpenCreateTierDispatched]);

  const openEdit = useCallback((t: MinimalOfferTemplateForPreview) => {
    setEditingId(t.id);
    setName(t.name);
    setQty(String(t.quantity ?? 1));
    setPrice(String(t.price ?? ''));
    setImageUrls(t.imageUrls ?? []);
    const st = t.status?.toUpperCase();
    setStatusDraft(
      st === 'INACTIVE' || st === 'ARCHIVED' ? (st as 'INACTIVE' | 'ARCHIVED') : 'ACTIVE',
    );
    setShowModal(true);
  }, []);

  useEffect(() => {
    if (!productId || !editTierKick || editTierKick.nonce <= lastEditTierNonce.current) return;
    const t = templates.find((x) => x.id === editTierKick.templateId);
    if (!t) return;
    lastEditTierNonce.current = editTierKick.nonce;
    openEdit(t);
    onEditTierKickDispatched?.();
  }, [productId, editTierKick, templates, openEdit, onEditTierKickDispatched]);

  function closeModal() {
    if (busy || uploadState === 'uploading') return;
    setShowModal(false);
  }

  function saveTier() {
    if (!productId) return;
    const trimmed = name.trim();
    const q = parseInt(qty, 10);
    const priceTrim = price.trim();
    if (!trimmed || !priceTrim || !Number.isFinite(q) || q < 1) return;

    const fd = new FormData();
    fd.set('intent', editingId ? 'updateOfferTemplate' : 'createOfferTemplate');
    fd.set('productId', productId);
    if (editingId) fd.set('templateId', editingId);
    fd.set('templateName', trimmed);
    fd.set('templateQty', String(q));
    fd.set('templatePrice', priceTrim);
    fd.set('templateImageUrls', JSON.stringify(imageUrls));
    if (editingId) fd.set('templateStatus', statusDraft);
    fetcher.submit(fd, { method: 'post' });
  }

  if (!productId) {
    return (
      <div className="card space-y-2">
        <h2 className="text-lg font-semibold text-app-fg">Offer tiers</h2>
        <p className="text-sm text-app-fg-muted">Select a catalog product above to create packages buyers pick on Edge forms.</p>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-app-fg">Offer tiers</h2>
          <p className="text-xs text-app-fg-muted mt-0.5 max-w-xl">
            Packages for this SKU on Edge forms — managed here, not on the product catalog. Active tiers can update the
            catalog list price (minimum tier price).
          </p>
        </div>
        {canManage && !readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            {hasArchivableTiers ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowArchiveAllConfirm(true)}>
                Archive all tiers
              </Button>
            ) : null}
            <Button type="button" variant="secondary" size="sm" onClick={openCreate}>
              New offer tier
            </Button>
          </div>
        ) : null}
      </div>

      <ConfirmActionModal
        open={showArchiveAllConfirm}
        onClose={() => setShowArchiveAllConfirm(false)}
        error={archiveSurface.errorMatchingIntent('archiveAllOfferTemplates')}
        title="Archive all offer tiers?"
        variant="warning"
        description={
          <>
            Every <strong>active</strong> and <strong>inactive</strong> tier for this SKU becomes archived. Forms that
            referenced those tiers clear their selection. Edge then uses catalog list price until you add new active
            tiers.
          </>
        }
        confirmLabel="Archive all"
        cancelLabel="Cancel"
        loading={archiveFetcher.state !== 'idle'}
        onConfirm={() => {
          if (!productId) return;
          const fd = new FormData();
          fd.set('intent', 'archiveAllOfferTemplates');
          fd.set('productId', productId);
          archiveFetcher.submit(fd, { method: 'post' });
        }}
      />

      {!canManage ? (
        <p className="text-sm text-app-fg-muted">
          You can view tiers. Creating or editing requires the offer-template permission.
        </p>
      ) : null}

      <CompactTable<MinimalOfferTemplateForPreview>
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (row) => row.name,
          },
          {
            key: 'qty',
            header: 'Qty',
            nowrap: true,
            render: (row) => String(row.quantity ?? 1),
          },
          {
            key: 'price',
            header: 'Price',
            nowrap: true,
            render: (row) => `₦${Number(row.price).toLocaleString()}`,
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            mobileShowLabel: false,
            render: (row) => (
              <span className="inline-flex flex-wrap items-center gap-2 justify-end">
                <StatusBadge status={row.status} />
                {canManage && !readOnly ? (
                  <TableActionButton type="button" variant="neutral" onClick={() => openEdit(row)} disabled={busy}>
                    Edit
                  </TableActionButton>
                ) : (
                  <TableActionButton type="button" variant="primary" onClick={() => setViewingTier(row)}>
                    View
                  </TableActionButton>
                )}
              </span>
            ),
          },
        ]}
        rowKey={(row) => row.id}
        rows={templates}
        emptyTitle="No offer tiers yet"
        emptyDescription="Add at least one tier so buyers can pick a package on this funnel."
      />

      <Modal
        open={!!viewingTier}
        onClose={() => setViewingTier(null)}
        maxWidth="max-w-md"
        aria-labelledby="offer-tier-view-title"
      >
        {viewingTier ? (
          <div className="p-5 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-app-fg" id="offer-tier-view-title">
                {viewingTier.name}
              </h2>
              <p className="text-xs text-app-fg-muted mt-0.5">Offer package (read-only)</p>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-app-fg-muted">Quantity</dt>
                <dd className="font-medium text-app-fg">{String(viewingTier.quantity ?? 1)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-app-fg-muted">Price</dt>
                <dd className="font-medium text-app-fg">
                  <NairaPrice amount={Number(viewingTier.price)} />
                </dd>
              </div>
              <div className="flex justify-between gap-3 items-center">
                <dt className="text-app-fg-muted">Status</dt>
                <dd>
                  <StatusBadge status={viewingTier.status} />
                </dd>
              </div>
            </dl>
            {(viewingTier.imageUrls?.length ?? 0) > 0 ? (
              <div>
                <p className="text-xs font-medium text-app-fg-muted mb-2">Images</p>
                <ul className="flex flex-wrap gap-2">
                  {viewingTier.imageUrls!.map((url) => (
                    <li key={url} className="w-20 h-20 rounded-lg border border-app-border overflow-hidden bg-app-hover shrink-0">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex justify-end pt-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setViewingTier(null)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={showModal} onClose={closeModal} maxWidth="max-w-md" aria-labelledby="offer-tier-modal-title">
        <div className="p-5 space-y-4">
          <ModalFetcherInlineError
            message={fetcherSurface.errorMatchingIntent(['createOfferTemplate', 'updateOfferTemplate'])}
          />
          <div>
            <h2 className="text-lg font-semibold text-app-fg" id="offer-tier-modal-title">
              {editingId ? 'Edit offer tier' : 'New offer tier'}
            </h2>
            <p className="text-xs text-app-fg-muted mt-0.5">Shown on Edge order forms that use this product.</p>
          </div>
          <TextInput label="Tier label" required placeholder="e.g. Buy 2" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Qty" type="number" required min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            <FormField label="Price (₦)" htmlFor="tier-price-modal">
              <AmountInput id="tier-price-modal" required placeholder="0.00" value={price} onChange={setPrice} />
            </FormField>
          </div>

          <div>
            <p className="text-xs font-medium text-app-fg-muted mb-1">Tier images (optional)</p>
            <OfferImagesEditor imageUrls={imageUrls} onChange={setImageUrls} compact disabled={busy} onUploadStateChange={setUploadState} />
          </div>

          {editingId ? (
            <FormField label="Status" htmlFor="templateStatusDraft">
              <FormSelect
                id="templateStatusDraft"
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value as typeof statusDraft)}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                  { value: 'ARCHIVED', label: 'Archived' },
                ]}
              />
            </FormField>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={closeModal} disabled={busy || uploadState === 'uploading'}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={busy}
              disabled={busy || uploadState === 'uploading' || !name.trim() || !price.trim()}
              onClick={saveTier}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
