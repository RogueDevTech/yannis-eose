import { useEffect, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Spinner } from '~/components/ui/spinner';
import { DetailRow } from '~/components/ui/live-activity-card';
import { useToast } from '~/components/ui/toast';
import type { PendingCart } from './types';

type RevealResult = { ok: boolean; phone?: string; isDialable?: boolean; error?: string };

export function AbandonedCartDetailModal({
  cart,
  canReveal,
  canRecover,
  onClose,
  onClear,
}: {
  cart: PendingCart | null;
  canReveal: boolean;
  /** When true, the "Recover as order" button is shown (uses edge-form path for MB attribution). */
  canRecover?: boolean;
  onClose: () => void;
  onClear?: (cart: PendingCart) => void;
}) {
  const revealFetcher = useFetcher<RevealResult>();
  const recoverFetcher = useFetcher<{ success?: boolean; error?: string; orderId?: string }>();
  const [phone, setPhone] = useState<string | null>(null);
  const [phoneState, setPhoneState] = useState<'idle' | 'loading' | 'masked' | 'unavailable' | 'error'>('idle');
  const { toast } = useToast();
  const isRecovering = recoverFetcher.state !== 'idle';

  // Close modal + toast on successful recovery.
  useEffect(() => {
    if (recoverFetcher.state !== 'idle' || !recoverFetcher.data) return;
    if (recoverFetcher.data.success) {
      toast.success('Order created from cart — MB attribution preserved');
      onClose();
    } else if (recoverFetcher.data.error) {
      toast.error('Recovery failed', recoverFetcher.data.error);
    }
  }, [recoverFetcher.state, recoverFetcher.data]);

  function handleRecover() {
    if (!cart) return;
    const fd = new FormData();
    fd.set('intent', 'recoverFromCart');
    fd.set('cartId', cart.id);
    recoverFetcher.submit(fd, { method: 'post', action: '/admin/cs/queue/carts' });
  }

  useEffect(() => {
    if (!cart) {
      setPhone(null);
      setPhoneState('idle');
      return;
    }
    if (!canReveal) {
      setPhoneState('masked');
      return;
    }
    // Inline phone preloaded in `cart.listAbandoned` for `cart.delete` holders —
    // no extra round-trip. Fall back to the audited reveal endpoint only when the
    // list payload doesn't carry it (older clients, partial cache, missing column).
    if (cart.customerPhone) {
      setPhone(cart.customerPhone);
      setPhoneState('idle');
      return;
    }
    setPhoneState('loading');
    setPhone(null);
    const fd = new FormData();
    fd.set('intent', 'revealAbandonedPhone');
    fd.set('cartId', cart.id);
    revealFetcher.submit(fd, { method: 'post', action: '/admin/cs/queue/carts' });
  }, [cart?.id, cart?.customerPhone, canReveal]);

  useEffect(() => {
    if (revealFetcher.state !== 'idle' || !revealFetcher.data) return;
    const data = revealFetcher.data;
    if (!data.ok) {
      setPhoneState('error');
      return;
    }
    if (!data.isDialable || !data.phone) {
      setPhoneState('unavailable');
      return;
    }
    setPhone(data.phone);
    setPhoneState('idle');
  }, [revealFetcher.state, revealFetcher.data]);

  const copyAll = async () => {
    if (!cart) return;
    const lines: Array<string | null> = [
      `Customer: ${cart.customerName}`,
      `Phone: ${phone ?? cart.customerPhoneDisplay}`,
      cart.customerEmail ? `Email: ${cart.customerEmail}` : null,
      `Product: ${cart.productName ?? '—'}`,
      cart.quantity ? `Quantity: ${cart.quantity}` : null,
      cart.offerLabel ? `Offer: ${cart.offerLabel}` : null,
      cart.campaignName ? `Campaign: ${cart.campaignName}` : null,
      cart.customerGender ? `Gender: ${cart.customerGender}` : null,
      cart.deliveryAddress
        ? `Delivery address: ${cart.deliveryAddress}`
        : cart.customerAddress
        ? `Address: ${cart.customerAddress}`
        : null,
      cart.deliveryState ? `State: ${cart.deliveryState}` : null,
      cart.preferredDeliveryDate ? `Preferred date: ${cart.preferredDeliveryDate}` : null,
      cart.paymentMethod ? `Payment method: ${cart.paymentMethod}` : null,
      cart.deliveryNotes ? `Notes: ${cart.deliveryNotes}` : null,
      `Dropped at: ${new Date(cart.updatedAt).toLocaleString('en-NG', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    ];
    if (cart.customFieldValues && Object.keys(cart.customFieldValues).length > 0) {
      for (const [key, value] of Object.entries(cart.customFieldValues)) {
        lines.push(`${key}: ${String(value)}`);
      }
    }
    const text = lines.filter((line): line is string => Boolean(line)).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Cart details copied');
    } catch {
      toast.error('Copy failed', 'Try again or long-press to copy manually.');
    }
  };

  const whatsappHref = phone
    ? `https://wa.me/${phone.replace(/^\+/, '').replace(/\D/g, '')}`
    : null;

  return (
    <Modal open={cart != null} onClose={onClose} maxWidth="max-w-md" backdropBlur>
      {cart && (
        <div>
          <div className="relative bg-gradient-to-br from-surface-700 to-surface-800 dark:from-surface-800 dark:to-surface-900 px-5 pt-5 pb-6 rounded-t-2xl md:rounded-t-xl">
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="min-w-0 pr-8">
              <p className="text-base font-bold text-white truncate">{cart.customerName}</p>
              <div className="mt-1 text-sm font-mono text-white/80 min-h-[1.25rem] flex items-center gap-2">
                {phoneState === 'loading' && (
                  <span className="inline-flex items-center gap-2 text-white/60">
                    <Spinner size="sm" /> Revealing…
                  </span>
                )}
                {phoneState === 'idle' && phone && (
                  <span className="text-white tracking-wide select-all">{phone}</span>
                )}
                {phoneState === 'masked' && (
                  <span className="text-white/70 tracking-wide">{cart.customerPhoneDisplay}</span>
                )}
                {phoneState === 'unavailable' && (
                  <span className="text-white/60 text-xs">Phone not captured for this cart</span>
                )}
                {phoneState === 'error' && (
                  <span className="text-danger-200 text-xs">Could not reveal phone</span>
                )}
              </div>
            </div>
            <div className="mt-3">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-app-hover/60 text-app-fg-muted">
                Dropped off
              </span>
            </div>
          </div>

          <div className="px-5 pt-4 pb-5">
            <div className="bg-app-elevated rounded-xl shadow-sm border border-app-border divide-y divide-app-border mb-4">
              <DetailRow
                label="Product"
                value={cart.productName ?? '—'}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                }
              />
              {cart.offerLabel && (
                <DetailRow
                  label="Offer"
                  value={cart.offerLabel}
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  }
                />
              )}
              {cart.campaignName && (
                <DetailRow
                  label="Campaign"
                  value={cart.campaignName}
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                    </svg>
                  }
                />
              )}
              {cart.quantity != null && (
                <DetailRow label="Quantity" value={String(cart.quantity)} />
              )}
              {cart.customerEmail && <DetailRow label="Email" value={cart.customerEmail} />}
              {cart.customerGender && <DetailRow label="Gender" value={cart.customerGender} />}
              {(cart.deliveryAddress || cart.customerAddress) && (
                <DetailRow
                  label={cart.deliveryAddress ? 'Delivery address' : 'Address'}
                  value={cart.deliveryAddress ?? cart.customerAddress ?? '—'}
                />
              )}
              {cart.deliveryState && <DetailRow label="State" value={cart.deliveryState} />}
              {cart.preferredDeliveryDate && (
                <DetailRow label="Preferred date" value={cart.preferredDeliveryDate} />
              )}
              {cart.paymentMethod && <DetailRow label="Payment method" value={cart.paymentMethod} />}
              {cart.deliveryNotes && <DetailRow label="Notes" value={cart.deliveryNotes} />}
              {cart.customFieldValues && Object.keys(cart.customFieldValues).length > 0 &&
                Object.entries(cart.customFieldValues).map(([key, value]) => (
                  <DetailRow key={key} label={key} value={String(value)} />
                ))}
              <DetailRow
                label="Dropped at"
                value={new Date(cart.updatedAt).toLocaleString('en-NG', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            </div>

            {phoneState === 'idle' && phone && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                <a
                  href={`tel:${phone}`}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-white bg-success-600 hover:bg-success-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  Call
                </a>
                {whatsappHref && (
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-white bg-[#25D366] hover:bg-[#1ebe5a] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20.52 3.48A11.93 11.93 0 0012.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.6 5.93L0 24l6.37-1.66a11.86 11.86 0 005.67 1.44h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.23-6.15-3.39-8.44zm-8.48 18.2a9.9 9.9 0 01-5.04-1.38l-.36-.21-3.78.99 1.01-3.68-.24-.38a9.86 9.86 0 01-1.51-5.16c0-5.45 4.43-9.88 9.88-9.88a9.83 9.83 0 016.99 2.89 9.83 9.83 0 012.89 6.99c0 5.45-4.43 9.88-9.88 9.88zm5.42-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15s-.77.97-.94 1.17c-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.39-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z" />
                    </svg>
                    WhatsApp
                  </a>
                )}
                <button
                  type="button"
                  onClick={copyAll}
                  title="Copy all cart details to clipboard"
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-app-fg bg-app-hover hover:bg-app-hover/80 border border-app-border transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy all
                </button>
              </div>
            )}

            {phoneState === 'unavailable' && (
              <p className="text-xs text-app-fg-muted mb-3 italic">
                This cart was captured before phone storage was enabled, so we can't reach the
                customer directly. Use Clear to remove it.
              </p>
            )}

            {canRecover && (
              <button
                type="button"
                onClick={handleRecover}
                disabled={isRecovering}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60 transition-colors mb-2"
              >
                {isRecovering ? (
                  <Spinner size="sm" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                )}
                {isRecovering ? 'Creating order…' : 'Recover as order'}
              </button>
            )}

            {onClear && (
              <button
                type="button"
                onClick={() => onClear(cart)}
                className="w-full text-xs font-medium text-danger-600 dark:text-danger-400 hover:underline py-2"
              >
                Clear this cart
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
