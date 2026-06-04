import { useCallback, useState, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageNotification } from '~/components/ui/page-notification';
import { useFetcherToast } from '~/components/ui/toast';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';

export interface ProductOption {
  id: string;
  name: string;
  offers?: Array<{ label: string; price: string; qty: number }>;
}

/** Cart data to pre-fill when recovering from an abandoned cart. */
export interface CartPrefill {
  cartId: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  deliveryAddress?: string;
  deliveryState?: string;
  deliveryNotes?: string;
  customerGender?: string;
  preferredDeliveryDate?: string;
  customerEmail?: string;
  paymentMethod?: string;
  productId?: string;
  offerLabel?: string;
  quantity?: number;
}

interface CreateOfflineOrderModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (orderId: string) => void;
  products: ProductOption[];
  initialCustomerName?: string;
  cartPrefill?: CartPrefill | null;
  branchId?: string;
  canEditPrices?: boolean;
}

export function CreateOfflineOrderModal({
  open,
  onClose,
  onSuccess,
  products,
  initialCustomerName,
  cartPrefill,
  branchId,
  canEditPrices = false,
}: CreateOfflineOrderModalProps) {
  const fetcher = useFetcher();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [deliveryState, setDeliveryState] = useState('');
  const [customerGender, setCustomerGender] = useState<'male' | 'female' | ''>('');
  const [preferredDeliveryDate, setPreferredDeliveryDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'PAY_ON_DELIVERY' | 'PAY_ONLINE'>('PAY_ON_DELIVERY');
  const [customerEmail, setCustomerEmail] = useState('');
  const [dismissedError, setDismissedError] = useState(false);

  // Product + offer selection (single product per order, like the customer flow)
  const [productId, setProductId] = useState('');
  const [selectedOfferLabel, setSelectedOfferLabel] = useState('');

  const selectedProduct = products.find((p) => p.id === productId);
  const offers = selectedProduct?.offers ?? [];
  const selectedOffer = offers.find((o) => o.label === selectedOfferLabel);

  useFetcherToast(fetcher.data, { successMessage: 'Offline order created', skipErrorToast: open });

  const actionError = fetcherSurface.rawError;
  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  useEffect(() => {
    if (open && cartPrefill) {
      if (cartPrefill.customerName) setCustomerName(cartPrefill.customerName);
      if (cartPrefill.customerPhone) setCustomerPhone(cartPrefill.customerPhone);
      if (cartPrefill.customerAddress) setCustomerAddress(cartPrefill.customerAddress);
      if (cartPrefill.deliveryAddress) setDeliveryAddress(cartPrefill.deliveryAddress);
      if (cartPrefill.deliveryState) setDeliveryState(cartPrefill.deliveryState);
      if (cartPrefill.deliveryNotes) setDeliveryNotes(cartPrefill.deliveryNotes);
      if (cartPrefill.customerGender) setCustomerGender(cartPrefill.customerGender as 'male' | 'female');
      if (cartPrefill.preferredDeliveryDate) setPreferredDeliveryDate(cartPrefill.preferredDeliveryDate);
      if (cartPrefill.customerEmail) setCustomerEmail(cartPrefill.customerEmail);
      if (cartPrefill.paymentMethod === 'PAY_ONLINE') setPaymentMethod('PAY_ONLINE');
      if (cartPrefill.productId) {
        setProductId(cartPrefill.productId);
        const product = products.find((p) => p.id === cartPrefill.productId);
        const offer = cartPrefill.offerLabel
          ? product?.offers?.find((o) => o.label === cartPrefill.offerLabel)
          : product?.offers?.[0];
        if (offer) setSelectedOfferLabel(offer.label);
      }
    } else if (open && initialCustomerName?.trim()) {
      setCustomerName(initialCustomerName.trim());
    }
  }, [open, initialCustomerName, cartPrefill]);

  const handleCreateOrderSuccess = useCallback(
    (data: { success: true } & Record<string, unknown>) => {
      const orderId = (data as { orderId?: string }).orderId;
      if (!orderId) return;
      onSuccess?.(orderId);
      onClose();
      resetForm();
    },
    [onSuccess, onClose],
  );
  useCloseOnFetcherSuccess(fetcher, handleCreateOrderSuccess);

  function resetForm() {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setDeliveryAddress('');
    setDeliveryNotes('');
    setDeliveryState('');
    setCustomerGender('');
    setPreferredDeliveryDate('');
    setPaymentMethod('PAY_ON_DELIVERY');
    setCustomerEmail('');
    setProductId('');
    setSelectedOfferLabel('');
  }

  function onProductChange(id: string) {
    setProductId(id);
    // Auto-select first offer
    const product = products.find((p) => p.id === id);
    const firstOffer = product?.offers?.[0];
    setSelectedOfferLabel(firstOffer?.label ?? '');
  }

  const totalAmount = selectedOffer ? Number(selectedOffer.price) : 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || !selectedOffer) return;

    const validItems = [{
      productId,
      quantity: selectedOffer.qty,
      unitPrice: Number(selectedOffer.price),
      offerLabel: selectedOffer.label,
    }];

    const formData = new FormData();
    formData.set('intent', 'createOffline');
    formData.set('customerName', customerName.trim());
    formData.set('customerPhone', customerPhone.trim());
    formData.set('paymentMethod', paymentMethod);
    formData.set('items', JSON.stringify(validItems));
    formData.set('totalAmount', String(totalAmount.toFixed(2)));
    if (cartPrefill?.cartId) formData.set('cartId', cartPrefill.cartId);
    if (customerAddress.trim()) formData.set('customerAddress', customerAddress.trim());
    if (deliveryAddress.trim()) formData.set('deliveryAddress', deliveryAddress.trim());
    if (deliveryNotes.trim()) formData.set('deliveryNotes', deliveryNotes.trim());
    if (deliveryState.trim()) formData.set('deliveryState', deliveryState.trim());
    if (customerGender) formData.set('customerGender', customerGender);
    if (preferredDeliveryDate.trim()) formData.set('preferredDeliveryDate', preferredDeliveryDate.trim());
    if (paymentMethod === 'PAY_ONLINE' && customerEmail.trim()) formData.set('customerEmail', customerEmail.trim());
    if (branchId?.trim()) formData.set('branchId', branchId.trim());
    fetcher.submit(formData, { method: 'post' });
  }

  if (!open) return null;

  const isSubmitting = fetcher.state !== 'idle';

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-lg"
      role="dialog"
      aria-labelledby="create-offline-order-title"
      contentClassName="p-0 flex flex-col overflow-hidden min-h-0 border border-app-border"
    >
        <div className="flex items-center justify-between border-b border-app-border pb-3 shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
          <h2 id="create-offline-order-title" className="text-lg font-semibold text-app-fg">
            {cartPrefill ? 'Recover from cart' : 'Create offline order'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-app-fg-muted hover:text-app-fg"
            aria-label="Close"
          >
            <span className="text-xl leading-none">&times;</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-4 sm:px-5 py-4">
            {actionError && !dismissedError && (
              <PageNotification
                variant="error"
                message={fetcherSurface.friendlyError}
                durationMs={5000}
                onDismiss={() => setDismissedError(true)}
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput
                type="text"
                label="Customer name *"
                required
                minLength={2}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Full name"
              />
              <TextInput
                type="tel"
                inputMode="numeric"
                label="Customer phone *"
                required
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value.replace(/[^\d+\-\s()]/g, ''))}
                placeholder="e.g. 08012345678"
                pattern="[0-9+\-\s()]*"
                title="Numbers only"
              />
            </div>

            <TextInput
              type="text"
              label="Customer address"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="Address"
            />
            <TextInput
              type="text"
              label="Delivery address"
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Delivery address"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput
                type="text"
                label="Delivery state"
                value={deliveryState}
                onChange={(e) => setDeliveryState(e.target.value)}
                placeholder="State"
              />
              <TextInput
                type="date"
                label="Preferred delivery date"
                value={preferredDeliveryDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setPreferredDeliveryDate(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <FormSelect
                id="offline-order-gender"
                label="Gender"
                value={customerGender}
                onChange={(e) => setCustomerGender(e.target.value as 'male' | 'female' | '')}
                placeholder="—"
                options={[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                ]}
              />
              <div className="flex-1 min-w-0">
                <FormSelect
                  id="offline-order-payment"
                  label="Payment method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as 'PAY_ON_DELIVERY' | 'PAY_ONLINE')}
                  options={[
                    { value: 'PAY_ON_DELIVERY', label: 'Pay on delivery' },
                    { value: 'PAY_ONLINE', label: 'Pay online' },
                  ]}
                  wrapperClassName="w-full"
                />
              </div>
            </div>
            {paymentMethod === 'PAY_ONLINE' && (
              <TextInput
                type="email"
                label="Customer email *"
                required={paymentMethod === 'PAY_ONLINE'}
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="email@example.com"
              />
            )}

            {/* ── Product + Offer Selection ───────────────── */}
            <div className="space-y-3">
              <SearchableSelect
                id="offline-order-product"
                label="Product *"
                required
                value={productId}
                onChange={onProductChange}
                placeholder="Select product"
                options={products.map((p) => ({ value: p.id, label: p.name }))}
                searchPlaceholder="Search products..."
                wrapperClassName="w-full"
              />

              {/* Offer cards — shown after product is selected */}
              {productId && offers.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-app-fg-muted mb-2">
                    Select offer *
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {offers.map((offer) => {
                      const isSelected = selectedOfferLabel === offer.label;
                      return (
                        <button
                          key={offer.label}
                          type="button"
                          onClick={() => setSelectedOfferLabel(offer.label)}
                          className={`rounded-lg border-2 p-3 text-left transition-colors ${
                            isSelected
                              ? 'border-brand-500 bg-brand-50/10 dark:bg-brand-900/20'
                              : 'border-app-border bg-app-elevated hover:border-app-fg-muted'
                          }`}
                        >
                          <p className="text-sm font-semibold text-app-fg">{offer.label}</p>
                          <div className="flex items-center justify-between gap-2 mt-1">
                            <span className="text-xs text-app-fg-muted">Qty: {offer.qty}</span>
                            <span className="text-sm font-bold text-app-fg tabular-nums">
                              <NairaPrice amount={Number(offer.price)} />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Selected offer summary */}
              {selectedOffer && (
                <div className="rounded-lg border border-app-border bg-app-hover px-3 py-2 flex items-center justify-between">
                  <div className="text-sm text-app-fg">
                    <span className="font-medium">{selectedProduct?.name}</span>
                    <span className="text-app-fg-muted"> · {selectedOffer.label} · Qty {selectedOffer.qty}</span>
                  </div>
                  <span className="text-sm font-bold text-app-fg tabular-nums">
                    <NairaPrice amount={totalAmount} />
                  </span>
                </div>
              )}
            </div>

            <TextInput
              type="text"
              label="Delivery notes"
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              placeholder="Notes"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-app-border shrink-0 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={isSubmitting || !selectedOffer}>
              Create offline order
            </Button>
          </div>
        </form>
    </Modal>
  );
}
