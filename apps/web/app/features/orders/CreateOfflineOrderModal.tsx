import { useState, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageNotification } from '~/components/ui/page-notification';
import { useFetcherToast } from '~/components/ui/toast';

export interface ProductOption {
  id: string;
  name: string;
  offers?: Array<{ label: string; price: string; qty: number }>;
}

interface CreateOfflineOrderModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (orderId: string) => void;
  products: ProductOption[];
  /** Prefill customer name when opening from Cart Abandonment */
  initialCustomerName?: string;
}

const defaultItem = { productId: '', quantity: 1, unitPrice: '', offerLabel: '' };

export function CreateOfflineOrderModal({
  open,
  onClose,
  onSuccess,
  products,
  initialCustomerName,
}: CreateOfflineOrderModalProps) {
  const fetcher = useFetcher();
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

  useFetcherToast(fetcher.data, { successMessage: 'Offline order created' });

  const actionError = (fetcher.data as { error?: string })?.error;
  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  useEffect(() => {
    if (open && items.length === 0) {
      setItems([{ ...defaultItem }]);
    }
  }, [open]);

  useEffect(() => {
    if (open && initialCustomerName?.trim()) {
      setCustomerName(initialCustomerName.trim());
    }
  }, [open, initialCustomerName]);

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) {
      const data = fetcher.data as { success?: boolean; orderId?: string; error?: string };
      if (data.success && data.orderId) {
        onSuccess?.(data.orderId);
        onClose();
        resetForm();
      }
    }
  }, [fetcher.state, fetcher.data, onSuccess, onClose]);

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
    const price = product?.offers?.[0]?.price ?? '';
    updateItem(index, 'productId', productId);
    updateItem(index, 'unitPrice', price);
    if (product?.offers?.[0]?.label) {
      updateItem(index, 'offerLabel', product.offers[0].label);
    }
  }

  const totalAmount = items.reduce((sum, it) => {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.unitPrice) || 0;
    return sum + qty * price;
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
    fetcher.submit(
      {
        intent: 'createOffline',
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerAddress: customerAddress.trim() || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        deliveryNotes: deliveryNotes.trim() || undefined,
        deliveryState: deliveryState.trim() || undefined,
        customerGender: customerGender || undefined,
        preferredDeliveryDate: preferredDeliveryDate.trim() || undefined,
        paymentMethod,
        customerEmail: paymentMethod === 'PAY_ONLINE' ? customerEmail.trim() : undefined,
        items: JSON.stringify(validItems),
        totalAmount: String(totalAmount.toFixed(2)),
      },
      { method: 'post' },
    );
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
            Create offline order
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
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-1">
            {actionError && !dismissedError && (
              <PageNotification
                variant="error"
                message={actionError}
                durationMs={5000}
                onDismiss={() => setDismissedError(true)}
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">
                Customer name *
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="input w-full"
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">
                Customer phone *
              </label>
              <input
                type="tel"
                required
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="input w-full"
                placeholder="e.g. 08012345678"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-app-fg-muted mb-1">
              Customer address
            </label>
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              className="input w-full"
              placeholder="Address"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-app-fg-muted mb-1">
              Delivery address
            </label>
            <input
              type="text"
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              className="input w-full"
              placeholder="Delivery address"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">
                Delivery state
              </label>
              <input
                type="text"
                value={deliveryState}
                onChange={(e) => setDeliveryState(e.target.value)}
                className="input w-full"
                placeholder="State"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">
                Preferred delivery date
              </label>
              <input
                type="text"
                value={preferredDeliveryDate}
                onChange={(e) => setPreferredDeliveryDate(e.target.value)}
                className="input w-full"
                placeholder="e.g. Tomorrow 10am"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">
                Gender
              </label>
              <select
                value={customerGender}
                onChange={(e) => setCustomerGender(e.target.value as 'male' | 'female' | '')}
                className="input"
              >
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-app-fg-muted mb-1">
                Payment method
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as 'PAY_ON_DELIVERY' | 'PAY_ONLINE')}
                className="input w-full"
              >
                <option value="PAY_ON_DELIVERY">Pay on delivery</option>
                <option value="PAY_ONLINE">Pay online</option>
              </select>
            </div>
          </div>
          {paymentMethod === 'PAY_ONLINE' && (
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">
                Customer email *
              </label>
              <input
                type="email"
                required={paymentMethod === 'PAY_ONLINE'}
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="input w-full"
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
              {items.map((item, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2 p-2 rounded-lg bg-app-hover">
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-xs text-app-fg-muted mb-0.5">Product</label>
                    <select
                      required
                      value={item.productId}
                      onChange={(e) => onProductSelect(index, e.target.value)}
                      className="input w-full text-sm"
                    >
                      <option value="">Select product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-20">
                    <label className="block text-xs text-app-fg-muted mb-0.5">Qty</label>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value, 10) || 1)}
                      className="input w-full text-sm"
                    />
                  </div>
                  <div className="w-28">
                    <label className="block text-xs text-app-fg-muted mb-0.5">Unit price</label>
                    <input
                      type="number"
                      required
                      min={0}
                      step={0.01}
                      value={item.unitPrice}
                      onChange={(e) => updateItem(index, 'unitPrice', e.target.value)}
                      className="input w-full text-sm"
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
              ))}
            </div>
            <p className="text-sm text-app-fg-muted mt-1">
              Total: ₦{totalAmount.toFixed(2)}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-app-fg-muted mb-1">
              Delivery notes
            </label>
            <input
              type="text"
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              className="input w-full"
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
