import { useCallback, useState, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageNotification } from '~/components/ui/page-notification';
import { useFetcherToast } from '~/components/ui/toast';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import { NumberInput } from '~/components/ui/number-input';
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
  /** Prefill customer name when opening from Cart Abandonment */
  initialCustomerName?: string;
  /** Full cart prefill when recovering from an abandoned cart (overrides initialCustomerName). */
  cartPrefill?: CartPrefill | null;
  /** SuperAdmin / org-wide heads: session may have no branch — required for `orders.createOffline` middleware. */
  branchId?: string;
}

const defaultItem = { productId: '', quantity: 1, unitPrice: '', offerLabel: '' };

export function CreateOfflineOrderModal({
  open,
  onClose,
  onSuccess,
  products,
  initialCustomerName,
  cartPrefill,
  branchId,
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
  const [items, setItems] = useState<Array<{ productId: string; quantity: number; unitPrice: string; offerLabel?: string }>>([{ ...defaultItem }]);
  const [dismissedError, setDismissedError] = useState(false);

  useFetcherToast(fetcher.data, { successMessage: 'Offline order created', skipErrorToast: open });

  const actionError = fetcherSurface.rawError;
  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  useEffect(() => {
    if (open && items.length === 0) {
      setItems([{ ...defaultItem }]);
    }
  }, [open]);

  useEffect(() => {
    if (open && cartPrefill) {
      // Full prefill from abandoned cart — overrides initialCustomerName.
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
        const product = products.find((p) => p.id === cartPrefill.productId);
        const offer = cartPrefill.offerLabel
          ? product?.offers?.find((o) => o.label === cartPrefill.offerLabel)
          : product?.offers?.[0];
        setItems([{
          productId: cartPrefill.productId,
          quantity: cartPrefill.quantity ?? offer?.qty ?? 1,
          unitPrice: offer?.price ?? '',
          offerLabel: offer?.label ?? cartPrefill.offerLabel ?? '',
        }]);
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
    setItems([{ ...defaultItem }]);
  }

  function addItem() {
    setItems((prev) => [...prev, { ...defaultItem }]);
  }

  function removeItem(index: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function updateItem(index: number, field: string, value: string | number) {
    setItems((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }

  function onProductSelect(index: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    // Pre-select the first offer when a product is chosen so the price isn't blank.
    // The user can switch to another tier via the Offer dropdown next to it.
    const firstOffer = product?.offers?.[0];
    setItems((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              productId,
              unitPrice: firstOffer?.price ?? '',
              offerLabel: firstOffer?.label ?? '',
              quantity: firstOffer?.qty ?? row.quantity ?? 1,
            }
          : row,
      ),
    );
  }

  /** Apply an offer (tier) to a row — fills label, price, and the offer's quantity. */
  function onOfferSelect(index: number, offerLabel: string) {
    const product = products.find((p) => p.id === items[index]?.productId);
    const offer = product?.offers?.find((o) => o.label === offerLabel);
    if (!offer) {
      // "Custom" — clear the offer label, keep current price/qty so the user can free-type.
      updateItem(index, 'offerLabel', '');
      return;
    }
    setItems((prev) =>
      prev.map((row, i) =>
        i === index
          ? { ...row, offerLabel: offer.label, unitPrice: offer.price, quantity: offer.qty }
          : row,
      ),
    );
  }

  // unitPrice is the offer/line total — sum directly without multiplying by quantity
  const totalAmount = items.reduce((sum, it) => {
    const price = Number(it.unitPrice) || 0;
    return sum + price;
  }, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items
      .filter((it) => it.productId && it.quantity >= 1 && it.unitPrice !== '')
      .map((it) => ({
        productId: it.productId,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        offerLabel: it.offerLabel || undefined,
      }));
    if (validItems.length === 0) {
      return;
    }
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
      maxWidth="max-w-2xl"
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
            <div>
              <TextInput
                type="text"
                label="Customer name *"
                required
                minLength={2}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <TextInput
                type="tel"
                inputMode="numeric"
                label="Customer phone *"
                required
                value={customerPhone}
                // Strip non-digit characters at the keystroke (allow `+` for
                // international, dashes/spaces for formatting). Letters never
                // make it into state — matches the form-builder phone field.
                onChange={(e) => setCustomerPhone(e.target.value.replace(/[^\d+\-\s()]/g, ''))}
                placeholder="e.g. 08012345678"
                pattern="[0-9+\-\s()]*"
                title="Numbers only"
              />
            </div>
          </div>

          <div>
            <TextInput
              type="text"
              label="Customer address"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="Address"
            />
          </div>
          <div>
            <TextInput
              type="text"
              label="Delivery address"
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Delivery address"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <TextInput
                type="text"
                label="Delivery state"
                value={deliveryState}
                onChange={(e) => setDeliveryState(e.target.value)}
                placeholder="State"
              />
            </div>
            <div>
              <TextInput
                type="date"
                label="Preferred delivery date"
                value={preferredDeliveryDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setPreferredDeliveryDate(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <div>
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
            </div>
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
            <div>
              <TextInput
                type="email"
                label="Customer email *"
                required={paymentMethod === 'PAY_ONLINE'}
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="email@example.com"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-app-fg-muted">
                Items *
              </label>
              <Button type="button" variant="secondary" size="sm" onClick={addItem}>
                Add item
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, index) => {
                const selectedProduct = products.find((p) => p.id === item.productId);
                const offers = selectedProduct?.offers ?? [];
                const hasOffers = offers.length > 0;
                return (
                  <div key={index} className="flex flex-wrap items-end gap-2 p-3 rounded-lg bg-app-hover">
                    <div className="flex-1 min-w-[140px]">
                      <SearchableSelect
                        id={`offline-item-product-${index}`}
                        label="Product"
                        required
                        value={item.productId}
                        onChange={(val) => onProductSelect(index, val)}
                        placeholder="Select product"
                        options={products.map((p) => ({ value: p.id, label: p.name }))}
                        controlSize="sm"
                        searchPlaceholder="Search products..."
                        wrapperClassName="w-full"
                      />
                    </div>
                    {/* Offer / tier — shows the configured price tiers (e.g. "1 piece @ ₦7,500"
                        vs "2 pieces @ ₦10,000"). Selecting one snaps the row's qty + price.
                        "Custom" lets the rep type a non-standard price (rare, but allowed). */}
                    {hasOffers && (
                      <div className="flex-1 min-w-[180px]">
                        <SearchableSelect
                          id={`offline-item-offer-${index}`}
                          label="Offer / tier"
                          value={item.offerLabel ?? ''}
                          onChange={(value) => onOfferSelect(index, value)}
                          options={[
                            ...offers.map((o) => ({
                              value: o.label,
                              label: `${o.label} — ${o.qty} × ₦${Number(o.price).toLocaleString()}`,
                            })),
                            { value: '', label: 'Custom' },
                          ]}
                          searchPlaceholder="Search offers..."
                          controlSize="sm"
                          wrapperClassName="w-full"
                        />
                      </div>
                    )}
                    <div className="w-20">
                      <NumberInput
                        label="Qty"
                        min={1}
                        fallbackValue={1}
                        value={Number(item.quantity) || 1}
                        onValueChange={(n) => updateItem(index, 'quantity', n)}
                        controlSize="sm"
                        wrapperClassName="w-full"
                      />
                    </div>
                    <div className="w-28">
                      <TextInput
                        type="number"
                        label="Unit price"
                        required
                        min={0}
                        step={0.01}
                        value={item.unitPrice}
                        onChange={(e) => updateItem(index, 'unitPrice', e.target.value)}
                        controlSize="sm"
                        wrapperClassName="w-full"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(index)}
                      disabled={items.length === 1}
                      className="shrink-0"
                    >
                      Remove
                    </Button>
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-app-fg-muted mt-1">
              Total: ₦{totalAmount.toFixed(2)}
            </p>
          </div>

          <div>
            <TextInput
              type="text"
              label="Delivery notes"
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              placeholder="Notes"
            />
          </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-app-border shrink-0 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
              Create offline order
            </Button>
          </div>
        </form>
    </Modal>
  );
}
