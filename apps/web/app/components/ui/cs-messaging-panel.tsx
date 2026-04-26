/**
 * CSMessagingPanel — Call (optional) + collapsible SMS/WhatsApp for CS agents.
 * SMS/WhatsApp stays collapsed with zero template/outbox/prepare requests until expanded and a channel is chosen.
 * Phone is never revealed to the client — sends go through server actions / device handlers as before.
 */

import { useState, useEffect, useRef } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal } from './modal';

interface MessageTemplate {
  id: string;
  name: string;
  channel: 'SMS' | 'WHATSAPP';
  body: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

interface OutboundMessage {
  id: string;
  channel: 'SMS' | 'WHATSAPP';
  renderedBody: string;
  status: 'SENT' | 'FAILED';
  sentAt: string;
  templateId: string | null;
}

interface CSMessagingPanelProps {
  orderId: string;
  customerName?: string | null;
  deliveryAddress?: string | null;
  productName?: string | null;
  estimatedDate?: string | null;
  /** Children rendered in the "Call" tab (existing VOIP/manual-call UI) */
  callContent?: React.ReactNode;
  /** Whether the call tab should be shown (VOIP or manual mode) */
  showCallTab?: boolean;
}

type TextChannel = 'sms' | 'whatsapp';

function ChannelIcon({ channel }: { channel: 'sms' | 'whatsapp' | 'call' }) {
  if (channel === 'call') {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
      </svg>
    );
  }
  if (channel === 'sms') {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    );
  }
  // WhatsApp
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export function CSMessagingPanel({
  orderId,
  customerName,
  deliveryAddress,
  productName,
  estimatedDate,
  callContent,
  showCallTab = true,
}: CSMessagingPanelProps) {
  /** SMS/WhatsApp composer is closed by default — no template/outbox/prepare requests until expanded. */
  const [textPanelOpen, setTextPanelOpen] = useState(false);
  const [textChannel, setTextChannel] = useState<TextChannel | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  const templatesFetcher = useFetcher<{ templates: MessageTemplate[] }>();
  const outboxFetcher = useFetcher<{ messages: OutboundMessage[] }>();
  const sendFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const smsFetcher = useFetcher<{ success?: boolean; error?: string; phone?: string; isDialable?: boolean }>();
  const smsPrepareFetcher = useFetcher<{ ready?: boolean; error?: string; phone?: string; isDialable?: boolean }>();
  const whatsappFetcher = useFetcher<{ success?: boolean; error?: string; phone?: string; isDialable?: boolean }>();
  const whatsappPrepareFetcher = useFetcher<{ ready?: boolean; error?: string; phone?: string; isDialable?: boolean }>();
  const smsWindowRef = useRef<Window | null>(null);
  const whatsappWindowRef = useRef<Window | null>(null);
  const [pendingSmsMessage, setPendingSmsMessage] = useState('');
  const [confirmSmsModalOpen, setConfirmSmsModalOpen] = useState(false);
  const [pendingSmsLogBody, setPendingSmsLogBody] = useState('');
  const [preparedSmsPhone, setPreparedSmsPhone] = useState<string | null>(null);
  const [pendingWhatsappMessage, setPendingWhatsappMessage] = useState('');
  const [confirmWhatsappModalOpen, setConfirmWhatsappModalOpen] = useState(false);
  const [pendingWhatsappLogBody, setPendingWhatsappLogBody] = useState('');
  const [preparedWhatsappPhone, setPreparedWhatsappPhone] = useState<string | null>(null);

  const closeTextPanel = () => {
    setTextPanelOpen(false);
    setTextChannel(null);
    setMessageBody('');
    setSelectedTemplateId('');
  };

  // Load templates only after user opens the panel and picks SMS or WhatsApp.
  useEffect(() => {
    if (!textPanelOpen || !textChannel) return;
    templatesFetcher.load(`/admin/api/messaging-templates?channel=${textChannel.toUpperCase()}`);
  }, [textPanelOpen, textChannel]);

  useEffect(() => {
    if (!textPanelOpen || textChannel !== 'sms' || preparedSmsPhone || smsPrepareFetcher.state !== 'idle') return;
    smsPrepareFetcher.submit({ intent: 'preparePhoneForSms' }, { method: 'post' });
  }, [textPanelOpen, textChannel, preparedSmsPhone, smsPrepareFetcher]);

  useEffect(() => {
    if (!textPanelOpen || textChannel !== 'whatsapp' || preparedWhatsappPhone || whatsappPrepareFetcher.state !== 'idle') return;
    whatsappPrepareFetcher.submit({ intent: 'preparePhoneForWhatsApp' }, { method: 'post' });
  }, [textPanelOpen, textChannel, preparedWhatsappPhone, whatsappPrepareFetcher]);

  // Load outbox only when SMS composer is active (same as before).
  useEffect(() => {
    if (!textPanelOpen || textChannel !== 'sms') return;
    outboxFetcher.load(`/admin/api/messaging-outbox?orderId=${orderId}`);
  }, [textPanelOpen, textChannel, orderId]);

  // Reset on successful send
  useEffect(() => {
    if (sendFetcher.state === 'idle' && sendFetcher.data?.success) {
      setMessageBody('');
      setSelectedTemplateId('');
      if (textChannel === 'sms') {
        outboxFetcher.load(`/admin/api/messaging-outbox?orderId=${orderId}`);
      }
    }
  }, [sendFetcher.state, sendFetcher.data, textChannel, orderId]);

  useEffect(() => {
    setSelectedTemplateId('');
    setMessageBody('');
  }, [textChannel]);

  useEffect(() => {
    if (smsPrepareFetcher.state !== 'idle') return;
    const data = smsPrepareFetcher.data;
    if (!data?.ready) return;
    if (!data.isDialable) return;
    const phone = data.phone?.trim();
    if (!phone) return;
    setPreparedSmsPhone(phone);
  }, [smsPrepareFetcher.state, smsPrepareFetcher.data]);

  useEffect(() => {
    if (whatsappPrepareFetcher.state !== 'idle') return;
    const data = whatsappPrepareFetcher.data;
    if (!data?.ready) return;
    if (!data.isDialable) return;
    const phone = data.phone?.trim();
    if (!phone) return;
    setPreparedWhatsappPhone(phone);
  }, [whatsappPrepareFetcher.state, whatsappPrepareFetcher.data]);

  const toSmsUrl = (phone: string, message: string): string => {
    const digitsOnly = phone.replace(/[^\d+]/g, '');
    const encoded = encodeURIComponent(message);
    return `sms:${digitsOnly}?body=${encoded}`;
  };

  const toWhatsappUrl = (phone: string, message: string): string => {
    const digitsOnly = phone.replace(/[^\d+]/g, '');
    let waPhone = digitsOnly.startsWith('+') ? digitsOnly.slice(1) : digitsOnly;
    // Local fallback normalization for Nigeria numbers entered as 0XXXXXXXXXX
    if (waPhone.startsWith('0')) {
      waPhone = `234${waPhone.slice(1)}`;
    }
    const encoded = encodeURIComponent(message);
    return `https://wa.me/${waPhone}?text=${encoded}`;
  };

  useEffect(() => {
    if (smsFetcher.state !== 'idle') return;
    const data = smsFetcher.data;
    if (!data) return;

    if (data.error) {
      if (smsWindowRef.current && !smsWindowRef.current.closed) {
        smsWindowRef.current.close();
      }
      smsWindowRef.current = null;
      return;
    }

    const phone = data.phone?.trim() ?? '';
    const message = pendingSmsMessage.trim();
    if (!data.success || !data.isDialable || !phone || !message) {
      if (smsWindowRef.current && !smsWindowRef.current.closed) {
        smsWindowRef.current.close();
      }
      smsWindowRef.current = null;
      return;
    }

    const smsUrl = toSmsUrl(phone, message);
    if (smsWindowRef.current && !smsWindowRef.current.closed) {
      smsWindowRef.current.location.href = smsUrl;
    } else {
      window.open(smsUrl, '_blank', 'noopener,noreferrer');
    }

    setPendingSmsLogBody(message);
    setConfirmSmsModalOpen(true);
    smsWindowRef.current = null;
    setPendingSmsMessage('');
    setMessageBody('');
    setSelectedTemplateId('');
  }, [smsFetcher.state, smsFetcher.data, pendingSmsMessage]);

  useEffect(() => {
    if (whatsappFetcher.state !== 'idle') return;
    const data = whatsappFetcher.data;
    if (!data) return;

    if (data.error) {
      if (whatsappWindowRef.current && !whatsappWindowRef.current.closed) {
        whatsappWindowRef.current.close();
      }
      whatsappWindowRef.current = null;
      return;
    }

    const phone = data.phone?.trim() ?? '';
    const message = pendingWhatsappMessage.trim();
    if (!data.success || !data.isDialable || !phone || !message) {
      if (whatsappWindowRef.current && !whatsappWindowRef.current.closed) {
        whatsappWindowRef.current.close();
      }
      whatsappWindowRef.current = null;
      return;
    }

    const waUrl = toWhatsappUrl(phone, message);

    if (whatsappWindowRef.current && !whatsappWindowRef.current.closed) {
      whatsappWindowRef.current.location.href = waUrl;
    } else {
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    }

    setPendingWhatsappLogBody(message);
    setConfirmWhatsappModalOpen(true);

    whatsappWindowRef.current = null;
    setPendingWhatsappMessage('');
    setMessageBody('');
    setSelectedTemplateId('');
  }, [whatsappFetcher.state, whatsappFetcher.data, pendingWhatsappMessage, orderId, sendFetcher]);

  const channelTemplates = (templatesFetcher.data?.templates ?? []).filter(
    (t) => textChannel !== null && t.channel === textChannel.toUpperCase()
  );
  const selectedTemplate = channelTemplates.find((t) => t.id === selectedTemplateId);
  const outboxMessages = (outboxFetcher.data?.messages ?? []).filter((msg) => msg.channel === 'SMS');
  const isSending = sendFetcher.state !== 'idle' || smsFetcher.state !== 'idle' || whatsappFetcher.state !== 'idle';

  const renderTemplateWithOrderData = (templateBody: string): string => {
    return templateBody
      .replace(/\{\{\s*customer_name\s*\}\}/g, customerName ?? '')
      .replace(/\{\{\s*order_id\s*\}\}/g, orderId.slice(0, 8).toUpperCase())
      .replace(/\{\{\s*product_name\s*\}\}/g, productName ?? '')
      .replace(/\{\{\s*delivery_address\s*\}\}/g, deliveryAddress ?? '')
      .replace(/\{\{\s*estimated_date\s*\}\}/g, estimatedDate ?? '');
  };

  const handleSend = () => {
    if (!textChannel) return;
    if (!messageBody.trim() && !selectedTemplateId) return;

    if (textChannel === 'sms') {
      const selected = channelTemplates.find((t) => t.id === selectedTemplateId);
      const composedMessage = selectedTemplateId && selected
        ? renderTemplateWithOrderData(selected.body)
        : messageBody.trim();
      if (!composedMessage) return;

      if (preparedSmsPhone) {
        window.open(toSmsUrl(preparedSmsPhone, composedMessage), '_blank', 'noopener,noreferrer');
        setPendingSmsLogBody(composedMessage);
        setConfirmSmsModalOpen(true);
        setMessageBody('');
        setSelectedTemplateId('');
        return;
      }

      smsWindowRef.current = window.open('', '_blank', 'noopener,noreferrer');
      setPendingSmsMessage(composedMessage);
      smsFetcher.submit(
        { intent: 'revealPhoneForSms' },
        { method: 'post' },
      );
      return;
    }

    if (textChannel === 'whatsapp') {
      const selected = channelTemplates.find((t) => t.id === selectedTemplateId);
      const composedMessage = selectedTemplateId && selected
        ? renderTemplateWithOrderData(selected.body)
        : messageBody.trim();
      if (!composedMessage) return;

      if (preparedWhatsappPhone) {
        window.open(toWhatsappUrl(preparedWhatsappPhone, composedMessage), '_blank', 'noopener,noreferrer');
        setPendingWhatsappLogBody(composedMessage);
        setConfirmWhatsappModalOpen(true);
        setMessageBody('');
        setSelectedTemplateId('');
        return;
      }

      whatsappWindowRef.current = window.open('', '_blank', 'noopener,noreferrer');
      setPendingWhatsappMessage(composedMessage);
      whatsappFetcher.submit(
        { intent: 'revealPhoneForWhatsApp' },
        { method: 'post' },
      );
      return;
    }
  };

  return (
    <>
    <div className="card">
      <h2 className="text-sm font-semibold text-app-fg mb-3">Customer Communication</h2>

      {showCallTab && (
        <div className="mb-4 pb-4 border-b border-app-border">
          {callContent ?? (
            <p className="text-sm text-app-fg-muted">
              VOIP call panel will appear here when the order is in CS Engaged status.
            </p>
          )}
        </div>
      )}

      {/* SMS/WhatsApp: collapsed until expanded; no network calls until a channel is chosen */}
      <div className="rounded-lg border border-app-border overflow-hidden">
        <button
          type="button"
          onClick={() => {
            if (textPanelOpen) {
              closeTextPanel();
            } else {
              setTextPanelOpen(true);
            }
          }}
          aria-expanded={textPanelOpen}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-app-fg bg-app-hover/40 hover:bg-app-hover/70 transition-colors duration-150"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="flex items-center gap-1 shrink-0 text-app-fg-muted">
              <ChannelIcon channel="sms" />
              <ChannelIcon channel="whatsapp" />
            </span>
            <span className="truncate">
              {textPanelOpen && textChannel
                ? textChannel === 'whatsapp'
                  ? 'WhatsApp'
                  : 'SMS'
                : 'SMS & WhatsApp'}
            </span>
          </span>
          <svg
            className={`w-4 h-4 shrink-0 text-app-fg-muted transition-transform duration-200 ${textPanelOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {textPanelOpen && (
          <div className="p-3 pt-3 space-y-3 border-t border-app-border bg-app-canvas/40">
            {!textChannel ? (
              // Initial channel picker — two tactile cards. No helper paragraph; the icons + labels carry it.
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTextChannel('sms')}
                  className="group flex flex-col items-center justify-center gap-1.5 rounded-xl border border-app-border bg-app-elevated px-3 py-4 text-app-fg transition-all duration-150 hover:border-primary-400 hover:shadow-sm hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/50 transition-colors">
                    <ChannelIcon channel="sms" />
                  </span>
                  <span className="text-sm font-medium">SMS</span>
                  <span className="text-[10px] text-app-fg-muted">160 char limit</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTextChannel('whatsapp')}
                  className="group flex flex-col items-center justify-center gap-1.5 rounded-xl border border-app-border bg-app-elevated px-3 py-4 text-app-fg transition-all duration-150 hover:border-success-400 hover:shadow-sm hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-success-500"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success-50 text-success-600 dark:bg-success-900/30 dark:text-success-400 group-hover:bg-success-100 dark:group-hover:bg-success-900/50 transition-colors">
                    <ChannelIcon channel="whatsapp" />
                  </span>
                  <span className="text-sm font-medium">WhatsApp</span>
                  <span className="text-[10px] text-app-fg-muted">Templates · freeform</span>
                </button>
              </div>
            ) : (
              // Channel chosen — compact header with a "switch channel" affordance
              <div className="flex items-center justify-between rounded-lg bg-app-elevated border border-app-border px-2.5 py-1.5">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full ${
                    textChannel === 'whatsapp'
                      ? 'bg-success-50 text-success-600 dark:bg-success-900/30 dark:text-success-400'
                      : 'bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                  }`}>
                    <ChannelIcon channel={textChannel === 'whatsapp' ? 'whatsapp' : 'sms'} />
                  </span>
                  <span className="text-sm font-medium text-app-fg">
                    {textChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setTextChannel(null);
                    setMessageBody('');
                    setSelectedTemplateId('');
                  }}
                  className="text-xs text-app-fg-muted hover:text-app-fg flex items-center gap-1 px-2 py-1 rounded hover:bg-app-hover transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h18" />
                  </svg>
                  Change
                </button>
              </div>
            )}

            {textChannel && (
        <div className="relative space-y-3 pt-1 min-h-[200px]">
          {templatesFetcher.state === 'loading' && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg bg-app-canvas/90 dark:bg-app-canvas/92 backdrop-blur-sm border border-app-border/60 shadow-sm"
              role="status"
              aria-live="polite"
              aria-busy="true"
              aria-label="Loading message templates"
            >
              <svg
                className="h-9 w-9 shrink-0 animate-spin text-primary-600 dark:text-primary-400"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <p className="text-sm font-medium text-app-fg">Loading templates…</p>
            </div>
          )}
          {/* Template picker — short list as pill row, longer lists fall back to a dropdown */}
          {channelTemplates.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-app-fg-muted">
                  Templates ({channelTemplates.length})
                </span>
                {selectedTemplateId && (
                  <button
                    type="button"
                    onClick={() => { setSelectedTemplateId(''); setMessageBody(''); }}
                    className="text-[11px] text-app-fg-muted hover:text-app-fg underline-offset-2 hover:underline"
                  >
                    Clear · write freeform
                  </button>
                )}
              </div>
              {channelTemplates.length <= 5 ? (
                <div className="flex flex-wrap gap-1.5">
                  {channelTemplates.map((tpl) => {
                    const active = tpl.id === selectedTemplateId;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setSelectedTemplateId(tpl.id);
                          setMessageBody(renderTemplateWithOrderData(tpl.body));
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                          active
                            ? textChannel === 'whatsapp'
                              ? 'bg-success-600 text-white border-success-600'
                              : 'bg-primary-600 text-white border-primary-600'
                            : 'bg-app-elevated border-app-border text-app-fg-muted hover:text-app-fg hover:border-app-fg-muted'
                        }`}
                      >
                        {tpl.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <select
                  value={selectedTemplateId}
                  onChange={(e) => {
                    setSelectedTemplateId(e.target.value);
                    if (e.target.value) {
                      const tpl = channelTemplates.find((t) => t.id === e.target.value);
                      if (tpl) setMessageBody(renderTemplateWithOrderData(tpl.body));
                    }
                  }}
                  className="input w-full text-sm"
                >
                  <option value="">Pick a template…</option>
                  {channelTemplates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                  ))}
                </select>
              )}
              {selectedTemplate && (
                <div className="p-2.5 rounded-lg bg-app-hover/60 text-xs text-app-fg-muted font-mono whitespace-pre-wrap border border-app-border">
                  {renderTemplateWithOrderData(selectedTemplate.body)}
                </div>
              )}
            </div>
          )}

          {/* Freeform message body for SMS and WhatsApp */}
          {!selectedTemplateId && (
            <div>
              <label className="block text-xs font-medium text-app-fg-muted mb-1">
                Message
              </label>
              <textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                rows={3}
                maxLength={textChannel === 'whatsapp' ? 1600 : 160}
                placeholder={textChannel === 'whatsapp' ? 'Type your WhatsApp message…' : 'Type your SMS message…'}
                className="input w-full text-sm resize-none"
              />
              <p className="text-[10px] text-app-fg-muted mt-0.5 text-right">
                {messageBody.length}/{textChannel === 'whatsapp' ? 1600 : 160}
              </p>
            </div>
          )}

          {templatesFetcher.state === 'idle' && channelTemplates.length === 0 && (
            <p className="text-xs text-app-fg-muted">
              No {textChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'} templates yet.{' '}
              <a href="/admin/cs/message-templates" className="text-primary-600 hover:underline">
                Create one
              </a>
            </p>
          )}

          {/* Error display */}
          {sendFetcher.data?.error && (
            <p className="text-xs text-danger-600 dark:text-danger-400">{sendFetcher.data.error}</p>
          )}
          {smsFetcher.data?.error && (
            <p className="text-xs text-danger-600 dark:text-danger-400">{smsFetcher.data.error}</p>
          )}
          {whatsappFetcher.data?.error && (
            <p className="text-xs text-danger-600 dark:text-danger-400">{whatsappFetcher.data.error}</p>
          )}
          {sendFetcher.data?.success && (
            <p className="text-xs text-success-600 dark:text-success-400">Message sent successfully.</p>
          )}
          {whatsappFetcher.data?.success && !whatsappFetcher.data?.error && (
            <p className="text-xs text-success-600 dark:text-success-400">WhatsApp opened with buyer and prefilled message.</p>
          )}
          {smsFetcher.data?.success && !smsFetcher.data?.error && (
            <p className="text-xs text-success-600 dark:text-success-400">SMS app opened with prefilled message.</p>
          )}

          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={isSending || (!messageBody.trim() && !selectedTemplateId)}
            className="w-full btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSending ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Sending…
              </>
            ) : (
              <>
                <ChannelIcon channel={textChannel === 'whatsapp' ? 'whatsapp' : 'sms'} />
                Send {textChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'}
              </>
            )}
          </button>

          {/* Message history */}
          {textChannel === 'sms' && outboxMessages.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-app-fg-muted mb-2">Sent SMS messages</p>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {outboxMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-lg px-3 py-2 text-xs ${
                      msg.status === 'FAILED'
                        ? 'bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800'
                        : 'bg-app-hover/60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`inline-flex items-center gap-1 font-medium ${
                        msg.channel === 'WHATSAPP' ? 'text-success-700 dark:text-success-400' : 'text-primary-700 dark:text-primary-400'
                      }`}>
                        <ChannelIcon channel={msg.channel === 'WHATSAPP' ? 'whatsapp' : 'sms'} />
                        {msg.channel}
                      </span>
                      <span className="text-app-fg-muted">
                        {new Date(msg.sentAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-app-fg-muted whitespace-pre-wrap">{msg.renderedBody}</p>
                    {msg.status === 'FAILED' && (
                      <p className="text-danger-600 dark:text-danger-400 mt-1">Send failed</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
            )}
          </div>
        )}
      </div>
    </div>
    <Modal
      open={confirmSmsModalOpen}
      onClose={() => {
        setConfirmSmsModalOpen(false);
        setPendingSmsLogBody('');
      }}
      maxWidth="max-w-sm"
      role="alertdialog"
      aria-labelledby="confirm-sms-title"
      aria-describedby="confirm-sms-desc"
      contentClassName="p-5"
    >
      <h3 id="confirm-sms-title" className="text-base font-semibold text-app-fg">
        Did you send this SMS message?
      </h3>
      <p id="confirm-sms-desc" className="mt-2 text-sm text-app-fg-muted">
        Confirm to sync this activity into order history.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => {
            setConfirmSmsModalOpen(false);
            setPendingSmsLogBody('');
          }}
        >
          Not yet
        </button>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => {
            const body = pendingSmsLogBody.trim();
            if (!body) return;
            sendFetcher.submit(
              {
                intent: 'sendMessage',
                orderId,
                channel: 'SMS',
                body,
              },
              { method: 'post', action: '/admin/api/send-message' },
            );
            setConfirmSmsModalOpen(false);
            setPendingSmsLogBody('');
          }}
        >
          Yes, sent
        </button>
      </div>
    </Modal>
    <Modal
      open={confirmWhatsappModalOpen}
      onClose={() => {
        setConfirmWhatsappModalOpen(false);
        setPendingWhatsappLogBody('');
      }}
      maxWidth="max-w-sm"
      role="alertdialog"
      aria-labelledby="confirm-whatsapp-title"
      aria-describedby="confirm-whatsapp-desc"
      contentClassName="p-5"
    >
      <h3 id="confirm-whatsapp-title" className="text-base font-semibold text-app-fg">
        Did you send this WhatsApp message?
      </h3>
      <p id="confirm-whatsapp-desc" className="mt-2 text-sm text-app-fg-muted">
        Confirm to sync this activity into order history.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => {
            setConfirmWhatsappModalOpen(false);
            setPendingWhatsappLogBody('');
          }}
        >
          Not yet
        </button>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => {
            const body = pendingWhatsappLogBody.trim();
            if (!body) return;
            sendFetcher.submit(
              {
                intent: 'sendMessage',
                orderId,
                channel: 'WHATSAPP',
                body,
              },
              { method: 'post', action: '/admin/api/send-message' },
            );
            setConfirmWhatsappModalOpen(false);
            setPendingWhatsappLogBody('');
          }}
        >
          Yes, sent
        </button>
      </div>
    </Modal>
    </>
  );
}
