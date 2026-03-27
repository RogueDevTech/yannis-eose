import { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { PageNotification } from '~/components/ui/page-notification';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useFetcherToast } from '~/components/ui/toast';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Tabs } from '~/components/ui/tabs';
import { Checkbox } from '~/components/ui/checkbox';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { CreateOfflineOrderModal } from '~/features/orders/CreateOfflineOrderModal';
import { useLiveIndicator, useSocketEvent } from '~/hooks/useSocket';
import type {
  CSDashboardStreamData,
  AgentWorkload,
  InactiveAgent,
  CSOrder,
  DuplicatePair,
  CSLeaderboardEntry,
  PendingCart,
  LiveActivityItem,
  CSQueueTab,
} from './types';

function resolveInitialActiveTab(
  initialTab: CSQueueTab | undefined,
  isClaimMode: boolean,
): CSQueueTab {
  if (initialTab === 'claim' && !isClaimMode) return 'queue';
  if (initialTab) return initialTab;
  return 'queue';
}

// ─── Agent Workload Card (reusable for strip + modal) ───

function AgentWorkloadCard({
  agent,
  className,
  onOpen,
  isNew,
}: {
  agent: AgentWorkload;
  className?: string;
  onOpen?: (agent: AgentWorkload) => void;
  isNew?: boolean;
}) {
  const utilization = agent.capacity > 0 ? (agent.pendingCount / agent.capacity) * 100 : 0;
  const barColor = utilization >= 90
    ? 'bg-danger-500'
    : utilization >= 70
    ? 'bg-warning-500'
    : 'bg-success-500';

  const inner = (
    <>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">
            {agent.agentName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
            {agent.agentName}
          </p>
          <p className="text-xs text-surface-800 dark:text-surface-200">
            {agent.pendingCount} of {agent.capacity} slots
          </p>
        </div>
      </div>
      <div className="w-full h-2 bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(utilization, 100)}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-surface-700 dark:text-surface-300">
          {Math.round(utilization)}% utilized
        </span>
        {agent.pendingCount >= agent.capacity && (
          <span className="text-xs font-medium text-danger-600 dark:text-danger-400">FULL</span>
        )}
      </div>
      {isNew && (
        <div className="mt-2 pt-2 border-t border-success-200 dark:border-success-800/50 flex items-center gap-1.5">
          <span className="animate-new-badge inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-success-500 text-white">
            NEW ORDER
          </span>
        </div>
      )}
    </>
  );

  const newClass = isNew
    ? 'animate-slide-in-up border-success-400 dark:border-success-500 bg-gradient-to-br from-success-50 to-white dark:from-success-900/20 dark:to-surface-800 shadow-md'
    : '';

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpen(agent)}
        className={`${className ?? 'card'} ${newClass} text-left cursor-pointer hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
      >
        {inner}
      </button>
    );
  }
  return <div className={`${className ?? 'card'} ${newClass}`}>{inner}</div>;
}

// ─── Agent Workload Detail Modal ───

function AgentWorkloadDetailModal({
  agent,
  onClose,
}: {
  agent: AgentWorkload | null;
  onClose: () => void;
}) {
  if (!agent) return null;

  const utilization = agent.capacity > 0 ? (agent.pendingCount / agent.capacity) * 100 : 0;
  const free = agent.capacity - agent.pendingCount;
  const statusColor =
    utilization >= 90 ? 'text-danger-600 dark:text-danger-400' :
    utilization >= 70 ? 'text-warning-600 dark:text-warning-400' :
    'text-success-600 dark:text-success-400';
  const barColor =
    utilization >= 90 ? 'bg-danger-500' :
    utilization >= 70 ? 'bg-warning-500' :
    'bg-success-500';
  const initials = agent.agentName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const lastAction = agent.lastActionAt
    ? new Date(agent.lastActionAt).toLocaleString('en-NG', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    : 'No recent action';

  return (
    <Modal open onClose={onClose} maxWidth="max-w-sm" contentClassName="p-0 overflow-hidden">
      {/* Header band */}
      <div className="bg-brand-600 dark:bg-brand-700 px-5 pt-5 pb-10 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <span className="text-lg font-bold text-white">{initials}</span>
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold text-white leading-tight truncate">{agent.agentName}</p>
            <p className="text-xs text-white/70 mt-0.5">CS Agent</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-5 -mt-6">
        <div className="bg-white dark:bg-surface-800 rounded-xl shadow-md border border-surface-100 dark:border-surface-700 p-3.5 grid grid-cols-3 gap-2.5">
          <div className="rounded-lg bg-surface-50 dark:bg-surface-900/60 border border-surface-100 dark:border-surface-700 px-2.5 py-2.5 text-center min-h-[74px] flex flex-col justify-center">
            <p className="text-[11px] leading-4 text-surface-500 dark:text-surface-400 uppercase tracking-wide">Active</p>
            <p className="text-xl leading-7 font-bold text-surface-900 dark:text-white mt-1">{agent.pendingCount}</p>
          </div>
          <div className="rounded-lg bg-surface-50 dark:bg-surface-900/60 border border-surface-100 dark:border-surface-700 px-2.5 py-2.5 text-center min-h-[74px] flex flex-col justify-center">
            <p className="text-[11px] leading-4 text-surface-500 dark:text-surface-400 uppercase tracking-wide">Capacity</p>
            <p className="text-xl leading-7 font-bold text-surface-900 dark:text-white mt-1">{agent.capacity}</p>
          </div>
          <div className="rounded-lg bg-surface-50 dark:bg-surface-900/60 border border-surface-100 dark:border-surface-700 px-2.5 py-2.5 text-center min-h-[74px] flex flex-col justify-center">
            <p className="text-[11px] leading-4 text-surface-500 dark:text-surface-400 uppercase tracking-wide">Free slots</p>
            <p className={`text-xl leading-7 font-bold mt-1 ${free <= 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>{Math.max(0, free)}</p>
          </div>
        </div>
      </div>

      {/* Utilization bar */}
      <div className="px-5 pt-5 pb-2">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-surface-600 dark:text-surface-400">Utilization</p>
          <p className={`text-xs font-bold ${statusColor}`}>{Math.round(utilization)}%</p>
        </div>
        <div className="w-full h-2.5 bg-surface-100 dark:bg-surface-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.min(utilization, 100)}%` }}
          />
        </div>
        {agent.pendingCount >= agent.capacity && (
          <p className="text-xs font-semibold text-danger-600 dark:text-danger-400 mt-1.5">Queue is full — no new orders can be assigned</p>
        )}
      </div>

      {/* Last action */}
      <div className="px-5 py-4 border-t border-surface-100 dark:border-surface-800">
        <p className="text-[10px] uppercase tracking-wider font-medium text-surface-400 dark:text-surface-500 mb-1">Last action</p>
        <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{lastAction}</p>
      </div>
    </Modal>
  );
}

// ─── Activity status helpers ───

type ActivityStage =
  | 'browsing'      // PENDING cart
  | 'abandoned'     // ABANDONED cart
  | 'order_placed'  // CONVERTED → order UNPROCESSED / CS_ASSIGNED
  | 'with_cs'       // CS_ENGAGED
  | 'confirmed'     // CONFIRMED
  | 'in_delivery'   // ALLOCATED / DISPATCHED / IN_TRANSIT
  | 'delivered'     // DELIVERED / COMPLETED
  | 'returned';     // RETURNED / PARTIALLY_DELIVERED

function resolveStage(item: LiveActivityItem): ActivityStage {
  if (item.cartStatus === 'ABANDONED') return 'abandoned';
  if (item.cartStatus === 'PENDING') return 'browsing';
  // CONVERTED cart or direct order — check order status
  const s = item.orderStatus ?? '';
  if (s === 'DELIVERED' || s === 'COMPLETED') return 'delivered';
  if (s === 'RETURNED' || s === 'PARTIALLY_DELIVERED' || s === 'WRITTEN_OFF') return 'returned';
  if (s === 'ALLOCATED' || s === 'DISPATCHED' || s === 'IN_TRANSIT') return 'in_delivery';
  if (s === 'CONFIRMED') return 'confirmed';
  if (s === 'CS_ENGAGED') return 'with_cs';
  return 'order_placed';
}

const STAGE_CONFIG: Record<ActivityStage, {
  label: string;
  dotColor: string;
  ping: boolean;
  cardBg: string;
  borderColor: string;
  badgeColor: string;
  textColor: string;
}> = {
  browsing:     { label: 'Browsing',      dotColor: 'bg-warning-400',  ping: true,  cardBg: 'bg-white dark:bg-surface-800',  borderColor: 'border-surface-200 dark:border-surface-700',  badgeColor: 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400',  textColor: 'text-warning-600 dark:text-warning-400' },
  abandoned:    { label: 'Dropped off',   dotColor: 'bg-surface-400',  ping: false, cardBg: 'bg-white dark:bg-surface-800',  borderColor: 'border-surface-200 dark:border-surface-700',  badgeColor: 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400',  textColor: 'text-surface-500 dark:text-surface-400' },
  order_placed: { label: 'Order placed',  dotColor: 'bg-brand-400',    ping: true,  cardBg: 'bg-white dark:bg-surface-800',  borderColor: 'border-brand-200 dark:border-brand-800',  badgeColor: 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400',  textColor: 'text-brand-600 dark:text-brand-400' },
  with_cs:      { label: 'With CS',       dotColor: 'bg-indigo-400',   ping: true,  cardBg: 'bg-white dark:bg-surface-800',  borderColor: 'border-indigo-200 dark:border-indigo-800',  badgeColor: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400',  textColor: 'text-indigo-600 dark:text-indigo-400' },
  confirmed:    { label: 'Confirmed',     dotColor: 'bg-brand-500',    ping: true,  cardBg: 'bg-white dark:bg-surface-800',  borderColor: 'border-brand-300 dark:border-brand-700',  badgeColor: 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400',  textColor: 'text-brand-600 dark:text-brand-400' },
  in_delivery:  { label: 'Out for delivery', dotColor: 'bg-info-400',  ping: true,  cardBg: 'bg-white dark:bg-surface-800',  borderColor: 'border-info-200 dark:border-info-800',  badgeColor: 'bg-info-100 dark:bg-info-900/30 text-info-700 dark:text-info-400',  textColor: 'text-info-600 dark:text-info-400' },
  delivered:    { label: 'Delivered ✓',   dotColor: 'bg-success-500',  ping: false, cardBg: 'bg-white dark:bg-surface-800',  borderColor: 'border-success-200 dark:border-success-800',  badgeColor: 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-400',  textColor: 'text-success-600 dark:text-success-400' },
  returned:     { label: 'Returned',      dotColor: 'bg-danger-400',   ping: false, cardBg: 'bg-white dark:bg-surface-800',  borderColor: 'border-danger-200 dark:border-danger-800',  badgeColor: 'bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400',  textColor: 'text-danger-600 dark:text-danger-400' },
};

// ─── Live activity card ───

function LiveActivityCard({
  item,
  isNew,
  isUpdated,
  onOpen,
}: {
  item: LiveActivityItem;
  isNew?: boolean;
  isUpdated?: boolean;
  onOpen: (item: LiveActivityItem) => void;
}) {
  const stage = resolveStage(item);
  const cfg = STAGE_CONFIG[stage];

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={`
        group relative w-full text-left rounded-xl border transition-all duration-200 cursor-pointer
        ${isNew
          ? 'animate-slide-in-up border-success-400 dark:border-success-500 bg-gradient-to-br from-success-50 to-white dark:from-success-900/20 dark:to-surface-800 shadow-md'
          : `${cfg.cardBg} ${cfg.borderColor} hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700`
        }
        ${(isNew || isUpdated) ? 'row-new-highlight' : ''}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
      `}
    >
      {/* Stage indicator dot */}
      <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
        {cfg.ping && !isNew ? (
          <>
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dotColor} opacity-60`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${cfg.dotColor}`} />
          </>
        ) : isNew ? (
          <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success-500" />
          </>
        ) : (
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${cfg.dotColor}`} />
        )}
      </span>

      <div className="p-3.5 pr-8">
        {/* Status pill */}
        <div className="mb-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cfg.badgeColor}`}>
            {cfg.label}
          </span>
        </div>

        {/* Name */}
        <div className="mb-2">
          <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate leading-tight">
            {item.customerName}
          </p>
        </div>

        {/* Product pill + amount */}
        {(item.productName || item.totalAmount) && (
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {item.productName && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200">
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <span className="truncate">{item.productName}</span>
              </span>
            )}
            {item.totalAmount && (
              <span className="text-[11px] font-bold text-surface-900 dark:text-surface-100 shrink-0">
                &#8358;{Number(item.totalAmount).toLocaleString('en-NG')}
              </span>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div className="text-[11px] font-medium text-surface-700 dark:text-surface-300">
          {new Date(item.updatedAt).toLocaleString('en-NG', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          })}
        </div>

        {/* NEW / UPDATED flash */}
        {(isNew || isUpdated) && (
          <div className={`mt-2 pt-2 border-t flex items-center gap-1.5 ${isNew ? 'border-success-200 dark:border-success-800/50' : 'border-success-200/60 dark:border-success-800/30'}`}>
            <span className="animate-new-badge inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-success-500 text-white">
              {isNew ? 'JUST NOW' : 'UPDATED'}
            </span>
            <span className={`text-[11px] ${cfg.textColor}`}>
              {isNew ? cfg.label : 'Status changed'}
            </span>
          </div>
        )}
      </div>

      {/* Hover arrow */}
      <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <svg className="w-3.5 h-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}

// ─── Live activity detail modal ───

function LiveActivityDetailModal({ item, onClose }: { item: LiveActivityItem | null; onClose: () => void }) {
  const stage = item ? resolveStage(item) : 'browsing';
  const cfg = item ? STAGE_CONFIG[stage] : STAGE_CONFIG.browsing;

  // Journey steps with filled/active/empty states
  const JOURNEY: { stage: ActivityStage; label: string }[] = [
    { stage: 'browsing',     label: 'Browsing' },
    { stage: 'order_placed', label: 'Order placed' },
    { stage: 'with_cs',      label: 'With CS' },
    { stage: 'confirmed',    label: 'Confirmed' },
    { stage: 'in_delivery',  label: 'Delivery' },
    { stage: 'delivered',    label: 'Delivered' },
  ];
  const ORDER_STAGES: ActivityStage[] = ['order_placed', 'with_cs', 'confirmed', 'in_delivery', 'delivered'];
  const stageIndex = JOURNEY.findIndex((j) => j.stage === stage);

  return (
    <Modal open={item != null} onClose={onClose} maxWidth="max-w-sm" backdropBlur>
      {item && (
        <div>
          {/* Header */}
          <div className="relative bg-gradient-to-br from-brand-600 to-brand-700 dark:from-brand-700 dark:to-brand-900 px-5 pt-5 pb-8 rounded-t-2xl md:rounded-t-xl">
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="min-w-0 pr-8">
              <p className="text-base font-bold text-white truncate">{item.customerName}</p>
              <p className="text-sm font-mono text-brand-200 truncate">{item.customerPhoneDisplay}</p>
            </div>
            <div className="mt-3">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${cfg.badgeColor}`}>
                {cfg.label}
              </span>
            </div>
          </div>

          {/* Journey progress bar */}
          {stage !== 'abandoned' && stage !== 'returned' && (
            <div className="px-5 pt-4 pb-0 -mt-2">
              <div className="bg-white dark:bg-surface-800 rounded-xl border border-surface-100 dark:border-surface-700 px-4 py-3">
                <div className="flex items-center justify-between gap-1">
                  {JOURNEY.map((j, i) => {
                    const isPast = i < stageIndex;
                    const isActive = i === stageIndex;
                    const needsOrder = ORDER_STAGES.includes(j.stage);
                    if (needsOrder && item.cartStatus !== 'CONVERTED') return null;
                    return (
                      <div key={j.stage} className="flex flex-col items-center gap-1 flex-1">
                        <div className={`w-2 h-2 rounded-full transition-colors ${isPast ? 'bg-success-500' : isActive ? cfg.dotColor : 'bg-surface-200 dark:bg-surface-700'}`} />
                        <span className={`text-[9px] font-medium text-center leading-tight ${isActive ? cfg.textColor : isPast ? 'text-success-600 dark:text-success-400' : 'text-surface-400 dark:text-surface-600'}`}>
                          {j.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Body */}
          <div className="px-5 pt-3 pb-5">
            <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-surface-100 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700 mb-3">
              <DetailRow label="Product" value={item.productName ?? '—'} icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              } />
              {item.offerLabel && (
                <DetailRow label="Offer" value={item.offerLabel} icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                } />
              )}
              {item.linkedOrderId && (
                <DetailRow label="Order ID" value={item.linkedOrderId.slice(0, 8).toUpperCase()} icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                } />
              )}
              <DetailRow
                label="Last activity"
                value={new Date(item.updatedAt).toLocaleString('en-NG', {
                  weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            </div>

            <p className="text-xs text-center text-surface-400 dark:text-surface-500">
              {stage === 'browsing' && 'Customer is actively browsing — they may convert soon.'}
              {stage === 'abandoned' && 'Customer left without placing an order.'}
              {stage === 'order_placed' && 'Order created — waiting for CS assignment.'}
              {stage === 'with_cs' && 'CS agent is engaged with this customer.'}
              {stage === 'confirmed' && 'Order confirmed — awaiting logistics allocation.'}
              {stage === 'in_delivery' && 'Out for delivery.'}
              {stage === 'delivered' && 'Successfully delivered.'}
              {stage === 'returned' && 'Order was returned.'}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Active order detail modal ───

function ActiveOrderDetailModal({
  order,
  agent,
  onClose,
  onReassign,
  onCancel,
}: {
  order: CSOrder | null;
  agent?: AgentWorkload;
  onClose: () => void;
  onReassign: (order: CSOrder) => void;
  onCancel: (order: CSOrder) => void;
}) {
  return (
    <Modal open={order != null} onClose={onClose} maxWidth="max-w-sm" backdropBlur>
      {order && (
        <div>
          {/* Header */}
          <div className="relative bg-gradient-to-br from-indigo-600 to-indigo-800 dark:from-indigo-700 dark:to-indigo-900 px-5 pt-5 pb-8 rounded-t-2xl md:rounded-t-xl">
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="min-w-0 pr-8">
              <p className="text-base font-bold text-white truncate">{order.customerName}</p>
              <p className="text-sm font-mono text-indigo-200 truncate">{order.customerPhoneDisplay}</p>
            </div>
            <div className="mt-3">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
                With CS
              </span>
            </div>
          </div>

          {/* Body */}
          <div className="px-5 pt-4 pb-5">
            <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-surface-100 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700 mb-4">
              <DetailRow
                label="Order ID"
                value={order.id.slice(0, 8).toUpperCase()}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                }
              />
              {order.totalAmount && (
                <DetailRow
                  label="Amount"
                  value={`\u20A6${Number(order.totalAmount).toLocaleString('en-NG')}`}
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  }
                />
              )}
              <DetailRow
                label="Assigned Agent"
                value={agent?.agentName ?? 'Unassigned'}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                }
              />
              <DetailRow
                label="Created"
                value={new Date(order.createdAt).toLocaleString('en-NG', {
                  weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <Link
                to={`/admin/orders/${order.id}`}
                onClick={onClose}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                View Full Order
              </Link>
              {order.assignedCsId && (
                <button
                  type="button"
                  onClick={() => { onClose(); onReassign(order); }}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                  Reassign Agent
                </button>
              )}
              <button
                type="button"
                onClick={() => { onClose(); onCancel(order); }}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-danger-700 dark:text-danger-300 bg-danger-50 dark:bg-danger-900/20 hover:bg-danger-100 dark:hover:bg-danger-900/40 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel Order
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="shrink-0 text-surface-400 dark:text-surface-500">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider font-medium text-surface-400 dark:text-surface-500">{label}</p>
        <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate mt-0.5">{value}</p>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────

export function CSDashboardPage({
  workloads,
  unassignedOrders,
  unassignedTotal,
  activeOrders,
  activeTotal,
  statusCounts,
  isClaimMode = false,
  claimCap = 2,
  inactiveAgents,
  callbackOrders,
  flaggedDuplicates,
  leaderboard,
  leaderboardPeriod = 'this_month',
  cartStats,
  claimQueue,
  liveEvents,
  canCreateOffline = false,
  canDeleteCart = false,
  productsForOfflineOrder = [],
  initialCartActivity,
  initialTab,
  initialHotSwapFrom,
}: CSDashboardStreamData) {
  const fetcher = useFetcher();
  const claimFetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();
  const cartsFetcher = useFetcher<{ activityItems?: LiveActivityItem[]; pendingCarts?: PendingCart[]; abandonedCarts?: PendingCart[] }>();
  const liveState = useLiveIndicator(liveEvents ?? []);
  const [createOfflineOpen, setCreateOfflineOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<CSQueueTab>(() =>
    resolveInitialActiveTab(initialTab, isClaimMode ?? false),
  );
  // Track which order is being claimed (to show per-row loading state)
  const [claimingOrderId, setClaimingOrderId] = useState<string | null>(null);
  const [assignAgent, setAssignAgent] = useState<Record<string, string>>({});
  const [hotSwapFrom, setHotSwapFrom] = useState(initialHotSwapFrom ?? '');
  const [hotSwapTo, setHotSwapTo] = useState('');
  const [hotSwapOrderIds, setHotSwapOrderIds] = useState<string[]>([]);
  /** Reassign order modal: order + current assignee so we can pick new agent */
  const [reassignOrder, setReassignOrder] = useState<{ orderId: string; customerName: string; assignedCsId: string } | null>(null);
  const [reassignToAgentId, setReassignToAgentId] = useState('');
  /** Pending confirm for Cancel order (replaces window.confirm) */
  const [cancelConfirmOrder, setCancelConfirmOrder] = useState<{ orderId: string; customerName: string } | null>(null);
  /** Selected live activity item for detail modal */
  const [selectedLiveCart, setSelectedLiveCart] = useState<LiveActivityItem | null>(null);
  /** Selected active (CS_ENGAGED) order for detail modal */
  const [selectedActiveOrder, setSelectedActiveOrder] = useState<CSOrder | null>(null);
  /** Selected unassigned queue order for detail modal */
  const [selectedQueueOrder, setSelectedQueueOrder] = useState<CSOrder | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentWorkload | null>(null);
  /** Agent Workloads: View all modal and pagination */
  const [viewAllAgentsOpen, setViewAllAgentsOpen] = useState(false);
  const [viewAllPage, setViewAllPage] = useState(1);
  /** Prefill Create Offline Order modal when opening from Cart Abandonment */
  const [createOfflinePrefill, setCreateOfflinePrefill] = useState<{ customerName: string } | null>(null);
  /** Delete abandoned cart confirmation modal */
  const [deleteCartConfirm, setDeleteCartConfirm] = useState<PendingCart | null>(null);
  /** IDs of carts that just appeared — used for NEW badge + slide-in animation */
  const [newCartIds, setNewCartIds] = useState<Set<string>>(new Set());
  /** IDs of carts that were updated (already known but data changed) — green ring flash */
  const [updatedCartIds, setUpdatedCartIds] = useState<Set<string>>(new Set());
  const knownCartIdsRef = useRef<Set<string>>(new Set());
  const prevCartsDataRef = useRef<Map<string, string>>(new Map());
  /** Agent IDs that just received a new order — for green highlight + sort-to-front */
  const [newAgentIds, setNewAgentIds] = useState<Set<string>>(new Set());
  const prevWorkloadCountsRef = useRef<Map<string, number>>(new Map());
  const liveActivityData = cartsFetcher.data ?? initialCartActivity ?? { activityItems: [], pendingCarts: [], abandonedCarts: [] };
  const deleteCartFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const overviewScrollRef = useRef<HTMLDivElement>(null);
  const agentScrollRef = useRef<HTMLDivElement>(null);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const [viewAllActivityOpen, setViewAllActivityOpen] = useState(false);
  const [viewAllActivityPage, setViewAllActivityPage] = useState(1);
  const scrollOverviewStrip = useCallback((delta: number) => {
    overviewScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const scrollAgentStrip = useCallback((delta: number) => {
    agentScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const scrollActivityStrip = useCallback((delta: number) => {
    activityScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (viewAllAgentsOpen) setViewAllPage(1);
  }, [viewAllAgentsOpen]);

  useEffect(() => {
    if (viewAllActivityOpen) setViewAllActivityPage(1);
  }, [viewAllActivityOpen]);

  useEffect(() => {
    if (!viewAllAgentsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewAllAgentsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewAllAgentsOpen]);

  // Fetch cart data on mount and whenever user switches to the Cart Abandonment tab
  useEffect(() => {
    cartsFetcher.load('/admin/cs/queue/carts');
  }, []);

  // Reload activity on any order event
  useSocketEvent('order:new', () => {
    cartsFetcher.load('/admin/cs/queue/carts');
  });
  useSocketEvent('order:status_changed', () => {
    cartsFetcher.load('/admin/cs/queue/carts');
  });

  const actionError = (fetcher.data as { error?: string })?.error;
  const [dismissedError, setDismissedError] = useState(false);
  const distributeResult = fetcher.data as { success?: boolean; distributed?: number } | undefined;
  const successMessage =
    distributeResult && 'distributed' in distributeResult
      ? distributeResult.distributed === 0
        ? 'No unassigned orders to distribute'
        : `${distributeResult.distributed} order(s) distributed to agents`
      : 'CS action completed';
  useFetcherToast(fetcher.data, { successMessage });
  useFetcherToast(claimFetcher.data, { successMessage: claimFetcher.data?.message ?? 'Order claimed' });
  useFetcherToast(deleteCartFetcher.data, { successMessage: 'Cart deleted' });

  // Close delete modal and refresh carts list after successful delete
  useEffect(() => {
    if (deleteCartFetcher.state === 'idle' && deleteCartFetcher.data?.ok) {
      setDeleteCartConfirm(null);
      cartsFetcher.load('/admin/cs/queue/carts');
    }
  }, [deleteCartFetcher.state, deleteCartFetcher.data]);

  // cart:updated socket event → reload carts fetcher directly (main loader revalidation won't refresh fetcher data)
  useSocketEvent('cart:updated', () => {
    cartsFetcher.load('/admin/cs/queue/carts');
  });

  // Detect newly arrived + updated activity items after each fetcher response
  useEffect(() => {
    const items = cartsFetcher.data?.activityItems;
    if (!items || cartsFetcher.state !== 'idle') return;

    const freshIds = new Set<string>();
    const changedIds = new Set<string>();

    for (const c of items) {
      const fingerprint = `${c.cartStatus}|${c.orderStatus ?? ''}|${c.offerLabel ?? ''}|${String(c.updatedAt)}`;
      if (!knownCartIdsRef.current.has(c.id)) {
        freshIds.add(c.id);
      } else if (prevCartsDataRef.current.get(c.id) !== fingerprint) {
        changedIds.add(c.id);
      }
      prevCartsDataRef.current.set(c.id, fingerprint);
    }

    knownCartIdsRef.current = new Set(items.map((c) => c.id));

    if (freshIds.size > 0) {
      setNewCartIds((prev) => new Set([...prev, ...freshIds]));
      setTimeout(() => {
        setNewCartIds((prev) => {
          const next = new Set(prev);
          freshIds.forEach((id) => next.delete(id));
          return next;
        });
      }, 3000);
    }

    if (changedIds.size > 0) {
      setUpdatedCartIds((prev) => new Set([...prev, ...changedIds]));
      setTimeout(() => {
        setUpdatedCartIds((prev) => {
          const next = new Set(prev);
          changedIds.forEach((id) => next.delete(id));
          return next;
        });
      }, 3000);
    }
  }, [cartsFetcher.data, cartsFetcher.state]);

  // Detect agents whose pendingCount increased → flash green "new order" highlight
  useEffect(() => {
    const freshAgents = new Set<string>();
    for (const w of workloads) {
      const prev = prevWorkloadCountsRef.current.get(w.agentId) ?? w.pendingCount;
      if (w.pendingCount > prev) {
        freshAgents.add(w.agentId);
      }
      prevWorkloadCountsRef.current.set(w.agentId, w.pendingCount);
    }
    if (freshAgents.size > 0) {
      setNewAgentIds((prev) => new Set([...prev, ...freshAgents]));
      setTimeout(() => {
        setNewAgentIds((prev) => {
          const next = new Set(prev);
          freshAgents.forEach((id) => next.delete(id));
          return next;
        });
      }, 3000);
    }
  }, [workloads]);

  // Clear claiming state after claim response
  useEffect(() => {
    if (claimFetcher.state === 'idle' && claimingOrderId) {
      setClaimingOrderId(null);
    }
  }, [claimFetcher.state]);

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  // Close reassign / cancel modals only after a successful response
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) {
      const result = fetcher.data as { success?: boolean };
      if (result.success) {
        if (reassignOrder) {
          setReassignOrder(null);
          setReassignToAgentId('');
        }
        if (cancelConfirmOrder) {
          setCancelConfirmOrder(null);
        }
      }
    }
  }, [fetcher.state, fetcher.data]);

  const totalPending = workloads.reduce((sum: number, w: AgentWorkload) => sum + w.pendingCount, 0);
  const totalCapacity = workloads.reduce((sum: number, w: AgentWorkload) => sum + w.capacity, 0);
  const confirmedCount = (statusCounts as Record<string, number>)['CONFIRMED'] ?? 0;
  const cancelledCount = (statusCounts as Record<string, number>)['CANCELLED'] ?? 0;

  // Get orders assigned to the hotswap source agent
  const hotSwapSourceOrders = activeOrders.filter(
    (o: CSOrder) => o.assignedCsId === hotSwapFrom,
  );

  function handleAssign(orderId: string) {
    const agentId = assignAgent[orderId];
    if (!agentId) return;
    fetcher.submit(
      { intent: 'assign', orderId, csAgentId: agentId },
      { method: 'post' },
    );
  }

  function handleHotSwap() {
    if (hotSwapOrderIds.length === 0 || !hotSwapFrom || !hotSwapTo) return;
    fetcher.submit(
      {
        intent: 'bulkReassign',
        orderIds: JSON.stringify(hotSwapOrderIds),
        fromAgentId: hotSwapFrom,
        toAgentId: hotSwapTo,
      },
      { method: 'post' },
    );
  }

  function handleReassignSubmit() {
    if (!reassignOrder || !reassignToAgentId || reassignToAgentId === reassignOrder.assignedCsId) return;
    fetcher.submit(
      {
        intent: 'bulkReassign',
        orderIds: JSON.stringify([reassignOrder.orderId]),
        fromAgentId: reassignOrder.assignedCsId,
        toAgentId: reassignToAgentId,
      },
      { method: 'post' },
    );
  }

  function toggleHotSwapOrder(orderId: string) {
    setHotSwapOrderIds((prev) =>
      prev.includes(orderId)
        ? prev.filter((id) => id !== orderId)
        : [...prev, orderId],
    );
  }

  function selectAllHotSwap() {
    setHotSwapOrderIds(hotSwapSourceOrders.map((o: CSOrder) => o.id));
  }

  // Suppress unused variable warning — cancelledCount may be used in future stats
  void cancelledCount;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Live activities</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Manage agents, dispatch orders, and monitor workloads
          </p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Showing today's data —{' '}
            {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' '}· Resets at midnight
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageRefreshButton />
          {canCreateOffline && (
            <Button variant="primary" size="sm" onClick={() => setCreateOfflineOpen(true)}>
              Create offline order
            </Button>
          )}
          {liveEvents != null && liveEvents.length > 0 && (
            <LiveIndicator isConnected={liveState.isConnected} showGreen={liveState.showGreen} />
          )}
        </div>
      </div>

      {canCreateOffline && (
        <CreateOfflineOrderModal
          open={createOfflineOpen}
          onClose={() => { setCreateOfflineOpen(false); setCreateOfflinePrefill(null); }}
          onSuccess={() => { setCreateOfflineOpen(false); setCreateOfflinePrefill(null); }}
          initialCustomerName={createOfflinePrefill?.customerName}
          products={productsForOfflineOrder}
        />
      )}

      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Overview + Order Pipeline (compact, single horizontal row) */}
      <div className="card">
        <div className="flex justify-end items-center gap-2 mb-3">
          <button
            type="button"
            onClick={() => scrollOverviewStrip(-280)}
            className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            aria-label="Scroll overview left"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => scrollOverviewStrip(280)}
            className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            aria-label="Scroll overview right"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <div ref={overviewScrollRef} className="flex flex-nowrap gap-3 overflow-x-auto scrollbar-hide pb-1">
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Active Agents
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {workloads.length}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Pending confirmation
            </p>
            <p className="text-xl font-bold text-warning-600 dark:text-warning-400 mt-1">
              {totalPending}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Unassigned
            </p>
            <p className="text-xl font-bold text-danger-600 dark:text-danger-400 mt-1">
              {unassignedTotal}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Confirmed
            </p>
            <p className="text-xl font-bold text-brand-600 dark:text-brand-400 mt-1">
              {confirmedCount}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Delivered
            </p>
            <p className="text-xl font-bold text-success-600 dark:text-success-400 mt-1">
              {(statusCounts as Record<string, number>)['DELIVERED'] ?? 0}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Capacity
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {totalPending}
              <span className="text-sm font-normal text-surface-700 dark:text-surface-300">
                /{totalCapacity}
              </span>
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              CS Engaged
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {(statusCounts as Record<string, number>)['CS_ENGAGED'] ?? 0}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Cancelled
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {(statusCounts as Record<string, number>)['CANCELLED'] ?? 0}
            </p>
          </div>
          {cartStats && (
            <>
              <DeferredSection resolve={cartStats} skeleton="inline">
                {(stats: { pending: number; abandonedLast24h: number }) => (
                  <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                    <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
                      Cart Pending
                    </p>
                    <p className="text-xl font-bold text-warning-600 dark:text-warning-400 mt-1">
                      {stats.pending}
                    </p>
                  </div>
                )}
              </DeferredSection>
              <DeferredSection resolve={cartStats} skeleton="inline">
                {(stats: { pending: number; abandonedLast24h: number }) => (
                  <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                    <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
                      Abandoned (24h)
                    </p>
                    <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
                      {stats.abandonedLast24h}
                    </p>
                  </div>
                )}
              </DeferredSection>
            </>
          )}
        </div>
      </div>

      {/* ── Live Activity Feed ──────────────────────────────── */}
      <div>
          {(() => {
            // Fall back to pendingCarts if listActivity isn't available yet (API not restarted)
            const rawActivity = liveActivityData.activityItems ?? [];
            const items: LiveActivityItem[] = rawActivity.length > 0
              ? rawActivity
              : (liveActivityData.pendingCarts ?? []).map((c) => ({
                  id: c.id,
                  customerName: c.customerName,
                  customerPhoneDisplay: c.customerPhoneDisplay,
                  productName: c.productName,
                  offerLabel: c.offerLabel,
                  cartStatus: 'PENDING' as const,
                  orderStatus: null,
                  linkedOrderId: null,
                  updatedAt: c.updatedAt,
                }));
            // Sort: new first, then updated, then rest by updatedAt desc
            const sorted = [...items].sort((a, b) => {
              const aNew = newCartIds.has(a.id) ? 2 : updatedCartIds.has(a.id) ? 1 : 0;
              const bNew = newCartIds.has(b.id) ? 2 : updatedCartIds.has(b.id) ? 1 : 0;
              if (aNew !== bNew) return bNew - aNew;
              return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
            });
            return (
              <>
                {/* Header row with controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-surface-900 dark:text-white flex items-center gap-2">
                      Live Activity
                      {newCartIds.size > 0 && (
                        <span className="animate-new-badge inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-success-500 text-white">
                          {newCartIds.size} new
                        </span>
                      )}
                      {cartsFetcher.state === 'loading' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-surface-400 dark:text-surface-500 font-normal">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Updating…
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                      Order activity — today · Click a card for details
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => scrollActivityStrip(-280)}
                      className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                      aria-label="Scroll left"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollActivityStrip(280)}
                      className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                      aria-label="Scroll right"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setViewAllActivityOpen(true)}>
                      View all
                    </Button>
                  </div>
                </div>

                {/* Horizontal scroll strip */}
                {sorted.length > 0 ? (
                  <div
                    ref={activityScrollRef}
                    className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
                  >
                    {sorted.map((item) => (
                      <div key={item.id} className="shrink-0 w-64">
                        <LiveActivityCard
                          item={item}
                          isNew={newCartIds.has(item.id)}
                          isUpdated={updatedCartIds.has(item.id)}
                          onOpen={setSelectedLiveCart}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                    <div className="w-10 h-10 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center mb-1">
                      <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-surface-700 dark:text-surface-300">No order activity today</p>
                    <p className="text-xs text-surface-400 dark:text-surface-500">Cards appear here as orders and carts come in</p>
                  </div>
                )}

                {/* View all modal — paginated, matches Agent Workloads modal */}
                {viewAllActivityOpen && (
                  <Modal open onClose={() => setViewAllActivityOpen(false)} maxWidth="max-w-4xl" role="dialog" aria-labelledby="view-all-activity-title" contentClassName="p-0 max-h-[90dvh] overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-100 dark:border-surface-800 shrink-0">
                      <h2 id="view-all-activity-title" className="text-lg font-semibold text-surface-900 dark:text-white">
                        All Live Activity
                      </h2>
                      <button
                        type="button"
                        onClick={() => setViewAllActivityOpen(false)}
                        className="p-2 rounded-lg text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                        aria-label="Close"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="px-4 py-2 border-b border-surface-100 dark:border-surface-800 shrink-0">
                      <p className="text-sm text-surface-600 dark:text-surface-400">
                        {sorted.length} item{sorted.length !== 1 ? 's' : ''} — today
                      </p>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                      {(() => {
                        const pageSize = 10;
                        const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
                        const page = Math.min(viewAllActivityPage, totalPages);
                        const start = (page - 1) * pageSize;
                        const rows = sorted.slice(start, start + pageSize);
                        return (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {rows.map((item) => (
                                <LiveActivityCard
                                  key={item.id}
                                  item={item}
                                  isNew={newCartIds.has(item.id)}
                                  isUpdated={updatedCartIds.has(item.id)}
                                  onOpen={(i) => { setViewAllActivityOpen(false); setSelectedLiveCart(i); }}
                                />
                              ))}
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
                              <span className="text-sm text-surface-600 dark:text-surface-400">
                                Page {page} of {totalPages}
                                {sorted.length > 0 && (
                                  <span className="ml-1">
                                    ({start + 1}–{Math.min(start + pageSize, sorted.length)} of {sorted.length})
                                  </span>
                                )}
                              </span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={page <= 1}
                                  onClick={() => setViewAllActivityPage((p) => Math.max(1, p - 1))}
                                >
                                  Prev
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={page >= totalPages}
                                  onClick={() => setViewAllActivityPage((p) => Math.min(totalPages, p + 1))}
                                >
                                  Next
                                </Button>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </Modal>
                )}
              </>
            );
          })()}
      </div>

      {/* Live activity detail modal */}
      <LiveActivityDetailModal item={selectedLiveCart} onClose={() => setSelectedLiveCart(null)} />

      {/* Active order detail modal */}
      <ActiveOrderDetailModal
        order={selectedActiveOrder}
        agent={selectedActiveOrder ? workloads.find((w: AgentWorkload) => w.agentId === selectedActiveOrder.assignedCsId) : undefined}
        onClose={() => setSelectedActiveOrder(null)}
        onReassign={(order) => order.assignedCsId && setReassignOrder({ orderId: order.id, customerName: order.customerName, assignedCsId: order.assignedCsId })}
        onCancel={(order) => setCancelConfirmOrder({ orderId: order.id, customerName: order.customerName })}
      />

      {/* Agent workload detail modal */}
      <AgentWorkloadDetailModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />

      {/* Agent Workloads — horizontal scroll strip + View all */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Agent Workloads</h2>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
              {workloads.length} active agent{workloads.length !== 1 ? 's' : ''} · {totalPending}/{totalCapacity} slots filled
            </p>
          </div>
          {workloads.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => scrollAgentStrip(-280)}
                className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                aria-label="Scroll left"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => scrollAgentStrip(280)}
                className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                aria-label="Scroll right"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setViewAllAgentsOpen(true)}
              >
                View all
              </Button>
            </div>
          )}
        </div>
        {workloads.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-surface-700 dark:text-surface-300">No CS agents found. Manage staff from HR → Users.</p>
          </div>
        ) : (
          <div
            ref={agentScrollRef}
            className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
          >
            {[...workloads]
              .sort((a, b) => {
                const aNew = newAgentIds.has(a.agentId) ? 1 : 0;
                const bNew = newAgentIds.has(b.agentId) ? 1 : 0;
                if (aNew !== bNew) return bNew - aNew;
                // Secondary: most recently active first
                const aTime = a.lastActionAt ? new Date(a.lastActionAt).getTime() : 0;
                const bTime = b.lastActionAt ? new Date(b.lastActionAt).getTime() : 0;
                return bTime - aTime;
              })
              .map((agent: AgentWorkload) => (
                <AgentWorkloadCard
                  key={agent.agentId}
                  agent={agent}
                  className="card shrink-0 w-64"
                  onOpen={setSelectedAgent}
                  isNew={newAgentIds.has(agent.agentId)}
                />
              ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-200 dark:border-surface-700">
        <Tabs
          value={activeTab}
          onChange={(v) => setActiveTab(v as typeof activeTab)}
          tabs={[
            { value: 'queue', label: `Unassigned Queue (${unassignedTotal})` },
            ...(isClaimMode
              ? [
                  {
                    value: 'claim' as const,
                    label: 'Claim Queue',
                    badge: claimQueue ? (
                      <DeferredSection resolve={claimQueue} skeleton="inline">
                        {(orders: CSOrder[]) =>
                          orders.length > 0 ? (
                            <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 text-xs font-bold">
                              {orders.length}
                            </span>
                          ) : null
                        }
                      </DeferredSection>
                    ) : undefined,
                  },
                ]
              : []),
            {
              value: 'active',
              label: `Active Orders (${activeTotal})`,
              badge: (
                <DeferredSection resolve={flaggedDuplicates} skeleton="inline">
                  {(pairs: DuplicatePair[]) =>
                    pairs.length > 0 ? (
                      <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400 text-xs font-bold" title={`${pairs.length} duplicate(s)`}>
                        ⚠{pairs.length}
                      </span>
                    ) : null
                  }
                </DeferredSection>
              ),
            },
            {
              value: 'callbacks',
              label: 'Callbacks',
              badge: (
                <DeferredSection resolve={callbackOrders} skeleton="inline">
                  {(orders: CSOrder[]) =>
                    orders.length > 0 ? (
                      <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400 text-xs font-bold">
                        {orders.length}
                      </span>
                    ) : null
                  }
                </DeferredSection>
              ),
            },
            { value: 'hotswap', label: 'Hot Swap' },
            { value: 'performance', label: 'Performance' },
          ]}
          className="border-b-0 flex-1 min-w-0"
        />
        {activeTab === 'queue' ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="shrink-0 -mb-px"
            disabled={fetcher.state !== 'idle'}
            onClick={() => fetcher.submit({ intent: 'redistribute' }, { method: 'post' })}
          >
            {fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'redistribute'
              ? 'Distributing…'
              : 'Distribute Order'}
          </Button>
        ) : (
          <Link
            to="/admin/cs/orders"
            className="btn-primary btn-sm shrink-0 -mb-px inline-flex items-center justify-center"
          >
            Go to Orders
          </Link>
        )}
      </div>

      {/* Tab Content — fixed height so layout does not shift */}
      {activeTab === 'queue' && (
        <div>
          {unassignedOrders.length === 0 ? (
            <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-10 text-center text-surface-600 dark:text-surface-400">
              No unassigned orders in queue
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {unassignedOrders.map((order: CSOrder) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setSelectedQueueOrder(order)}
                  className="group relative w-full text-left rounded-xl border border-warning-200 dark:border-warning-800/60 bg-white dark:bg-surface-800 hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {/* Pulsing dot */}
                  <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning-500" />
                  </span>

                  <div className="p-3.5 pr-8">
                    {/* Status badge */}
                    <div className="mb-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400">
                        Unassigned
                      </span>
                    </div>

                    {/* Customer name */}
                    <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate leading-tight mb-2">
                      {order.customerName}
                    </p>

                    {/* Amount */}
                    {order.totalAmount && (
                      <div className="mb-2">
                        <span className="text-[11px] font-bold text-surface-900 dark:text-surface-100">
                          &#8358;{Number(order.totalAmount).toLocaleString('en-NG')}
                        </span>
                      </div>
                    )}

                    {/* Timestamp */}
                    <div className="text-[11px] font-medium text-surface-600 dark:text-surface-400">
                      {new Date(order.createdAt).toLocaleString('en-NG', {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </div>
                  </div>

                  {/* Hover arrow */}
                  <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg className="w-3.5 h-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Queue Order Detail Modal ── */}
      {selectedQueueOrder && (() => {
        const qOrder = selectedQueueOrder;
        return (
          <Modal open onClose={() => setSelectedQueueOrder(null)} maxWidth="max-w-sm" backdropBlur>
            <div>
              {/* Header */}
              <div className="relative bg-gradient-to-br from-warning-500 to-warning-700 dark:from-warning-600 dark:to-warning-900 px-5 pt-5 pb-8 rounded-t-2xl md:rounded-t-xl">
                <button
                  type="button"
                  onClick={() => setSelectedQueueOrder(null)}
                  className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="min-w-0 pr-8">
                  <p className="text-base font-bold text-white truncate">{qOrder.customerName}</p>
                  <p className="text-sm font-mono text-warning-100 truncate">{qOrder.customerPhoneDisplay}</p>
                </div>
                <div className="mt-3">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400">
                    Unassigned
                  </span>
                </div>
              </div>

              {/* Body */}
              <div className="px-5 pt-4 pb-5">
                {/* Order details */}
                <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-surface-100 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700 mb-4">
                  <DetailRow
                    label="Order ID"
                    value={qOrder.id.slice(0, 8).toUpperCase()}
                    icon={
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    }
                  />
                  {qOrder.totalAmount && (
                    <DetailRow
                      label="Amount"
                      value={`\u20A6${Number(qOrder.totalAmount).toLocaleString('en-NG')}`}
                      icon={
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      }
                    />
                  )}
                  <DetailRow
                    label="Created"
                    value={new Date(qOrder.createdAt).toLocaleString('en-NG', {
                      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                    icon={
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    }
                  />
                </div>

                {/* Assign agent */}
                <div className="mb-3">
                  <label className="block text-xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-wide mb-1.5">
                    Assign to Agent
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={assignAgent[qOrder.id] ?? ''}
                      onChange={(e) => setAssignAgent((prev) => ({ ...prev, [qOrder.id]: e.target.value }))}
                      className="input py-1.5 text-sm flex-1"
                    >
                      <option value="">Select agent...</option>
                      {workloads
                        .filter((w: AgentWorkload) => w.pendingCount < w.capacity)
                        .map((w: AgentWorkload) => (
                          <option key={w.agentId} value={w.agentId}>
                            {w.agentName} ({w.pendingCount}/{w.capacity})
                          </option>
                        ))}
                    </select>
                    <Button
                      onClick={() => { handleAssign(qOrder.id); setSelectedQueueOrder(null); }}
                      disabled={!assignAgent[qOrder.id] || fetcher.state === 'submitting'}
                      variant="primary"
                      size="sm"
                      loading={fetcher.state === 'submitting'}
                      loadingText="..."
                    >
                      Assign
                    </Button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 pt-1">
                  <Link
                    to={`/admin/orders/${qOrder.id}`}
                    onClick={() => setSelectedQueueOrder(null)}
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    View Full Order
                  </Link>
                  <button
                    type="button"
                    onClick={() => { setSelectedQueueOrder(null); setCancelConfirmOrder({ orderId: qOrder.id, customerName: qOrder.customerName }); }}
                    disabled={fetcher.state === 'submitting'}
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-danger-700 dark:text-danger-300 bg-danger-50 dark:bg-danger-900/20 hover:bg-danger-100 dark:hover:bg-danger-900/40 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel Order
                  </button>
                </div>
              </div>
            </div>
          </Modal>
        );
      })()}

      {activeTab === 'active' && (
        <div>
          {/* Card grid — matches live activity style */}
          {activeOrders.length === 0 ? (
            <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-10 text-center text-surface-600 dark:text-surface-400">
              No active CS-engaged orders today
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {activeOrders.map((order: CSOrder) => {
                const agent = workloads.find((w: AgentWorkload) => w.agentId === order.assignedCsId);
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setSelectedActiveOrder(order)}
                    className="group relative w-full text-left rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-surface-800 hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {/* Live pulse dot */}
                    <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-60" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500" />
                    </span>

                    <div className="p-3.5 pr-8">
                      {/* Status badge */}
                      <div className="mb-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
                          With CS
                        </span>
                      </div>

                      {/* Customer name */}
                      <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate leading-tight mb-2">
                        {order.customerName}
                      </p>

                      {/* Amount */}
                      {order.totalAmount && (
                        <div className="mb-2">
                          <span className="text-[11px] font-bold text-surface-900 dark:text-surface-100">
                            &#8358;{Number(order.totalAmount).toLocaleString('en-NG')}
                          </span>
                        </div>
                      )}

                      {/* Agent pill */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <svg className="w-3 h-3 shrink-0 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span className="text-[11px] font-medium text-surface-700 dark:text-surface-300 truncate">
                          {agent?.agentName ?? 'Unassigned'}
                        </span>
                      </div>

                      {/* Timestamp */}
                      <div className="text-[11px] font-medium text-surface-600 dark:text-surface-400">
                        {new Date(order.createdAt).toLocaleString('en-NG', {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </div>
                    </div>

                    {/* Hover arrow */}
                    <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg className="w-3.5 h-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'hotswap' && (
        <div className="h-[28rem] overflow-auto">
          <div className="space-y-4">
          <div className="card">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">Hot Swap</h2>
            <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
              Select orders from one agent and bulk-reassign them to another agent.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  From Agent
                </label>
                <select
                  value={hotSwapFrom}
                  onChange={(e) => {
                    setHotSwapFrom(e.target.value);
                    setHotSwapOrderIds([]);
                  }}
                  className="input"
                >
                  <option value="">Select source agent...</option>
                  {workloads.map((w: AgentWorkload) => (
                    <option key={w.agentId} value={w.agentId}>
                      {w.agentName} ({w.pendingCount} orders)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  To Agent
                </label>
                <select
                  value={hotSwapTo}
                  onChange={(e) => setHotSwapTo(e.target.value)}
                  className="input"
                >
                  <option value="">Select target agent...</option>
                  {workloads
                    .filter((w: AgentWorkload) => w.agentId !== hotSwapFrom)
                    .map((w: AgentWorkload) => (
                      <option key={w.agentId} value={w.agentId}>
                        {w.agentName} ({w.pendingCount}/{w.capacity})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {hotSwapFrom && hotSwapSourceOrders.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-surface-700 dark:text-surface-300">
                    Select orders to reassign ({hotSwapOrderIds.length} selected)
                  </p>
                  <button
                    onClick={selectAllHotSwap}
                    className="text-sm text-brand-500 hover:text-brand-600 font-medium"
                  >
                    Select All ({hotSwapSourceOrders.length})
                  </button>
                </div>

                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {hotSwapSourceOrders.map((order: CSOrder) => (
                    <label
                      key={order.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={hotSwapOrderIds.includes(order.id)}
                        onChange={() => toggleHotSwapOrder(order.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                            {order.customerName}
                          </span>
                          <OrderStatusBadge status={order.status} />
                        </div>
                        <span className="text-xs text-surface-700 dark:text-surface-300">
                          {order.id.slice(0, 8)}... &middot; {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            {hotSwapFrom && hotSwapSourceOrders.length === 0 && (
              <p className="text-sm text-surface-700 dark:text-surface-300 text-center py-4">
                No active orders for this agent
              </p>
            )}
          </div>

          {/* Hot Swap action */}
          {hotSwapOrderIds.length > 0 && hotSwapTo && (
            <div className="flex items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => setHotSwapOrderIds([])}>
                Clear Selection
              </Button>
              <Button
                variant="primary"
                onClick={handleHotSwap}
                disabled={fetcher.state === 'submitting'}
                loading={fetcher.state === 'submitting'}
                loadingText="Reassigning..."
              >
                {`Reassign ${hotSwapOrderIds.length} Order${hotSwapOrderIds.length > 1 ? 's' : ''}`}
              </Button>
            </div>
          )}
          </div>
        </div>
      )}

      {/* ── Claim Queue Tab ──────────────────────────── */}
      {activeTab === 'claim' && claimQueue && (
        <DeferredSection resolve={claimQueue} skeleton="table">
          {(orders: CSOrder[]) => (
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Claim Queue</h2>
                    <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
                      Unassigned orders available to claim. First agent to click Claim takes the order.
                      Cap: <strong>{claimCap}</strong> unconfirmed orders per agent.
                    </p>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-success-600 dark:text-success-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-success-500 inline-block animate-pulse" />
                    Live
                  </span>
                </div>

                {orders.length === 0 ? (
                  <div className="text-center py-12 text-surface-700 dark:text-surface-300">
                    No orders in the claim queue right now.
                  </div>
                ) : (
                  <>
                    {/* Desktop table */}
                    <div className="hidden md:block overflow-auto">
                      <table className="w-full">
                        <thead>
                          <tr>
                            <th className="table-header">Order</th>
                            <th className="table-header">Customer</th>
                            <th className="table-header">Phone</th>
                            <th className="table-header text-right">Amount</th>
                            <th className="table-header">Received</th>
                            <th className="table-header" />
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map((order: CSOrder) => {
                            const isClaiming = claimingOrderId === order.id && claimFetcher.state === 'submitting';
                            // Count how many unconfirmed orders the current user has
                            // We cap check is enforced server-side; disable button while submitting
                            return (
                              <tr key={order.id} className="table-row">
                                <td className="table-cell">
                                  <Link
                                    to={`/admin/orders/${order.id}`}
                                    className="text-brand-500 hover:text-brand-600 font-mono text-xs font-medium"
                                  >
                                    {order.id.slice(0, 8).toUpperCase()}
                                  </Link>
                                </td>
                                <td className="table-cell">
                                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{order.customerName}</p>
                                </td>
                                <td className="table-cell">
                                  <span className="text-xs font-mono text-surface-700 dark:text-surface-300">{order.customerPhoneDisplay}</span>
                                </td>
                                <td className="table-cell text-right text-sm">
                                  {order.totalAmount ? `₦${Number(order.totalAmount).toLocaleString()}` : '—'}
                                </td>
                                <td className="table-cell text-xs text-surface-700 dark:text-surface-300">
                                  {new Date(order.createdAt).toLocaleString('en-NG', {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                  })}
                                </td>
                                <td className="table-cell text-right">
                                  <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    loading={isClaiming}
                                    loadingText="Claiming..."
                                    disabled={claimFetcher.state === 'submitting'}
                                    onClick={() => {
                                      setClaimingOrderId(order.id);
                                      claimFetcher.submit(
                                        { intent: 'claimOrder', orderId: order.id },
                                        { method: 'post' },
                                      );
                                    }}
                                  >
                                    Claim
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden space-y-3">
                      {orders.map((order: CSOrder) => {
                        const isClaiming = claimingOrderId === order.id && claimFetcher.state === 'submitting';
                        return (
                          <div
                            key={order.id}
                            className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 space-y-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <Link
                                  to={`/admin/orders/${order.id}`}
                                  className="text-brand-500 hover:text-brand-600 font-mono text-xs font-medium"
                                >
                                  {order.id.slice(0, 8).toUpperCase()}
                                </Link>
                                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 mt-0.5">{order.customerName}</p>
                                <p className="text-xs font-mono text-surface-700 dark:text-surface-300">{order.customerPhoneDisplay}</p>
                                {order.totalAmount && (
                                  <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">₦{Number(order.totalAmount).toLocaleString()}</p>
                                )}
                                <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                                  {new Date(order.createdAt).toLocaleString('en-NG', {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                  })}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                loading={isClaiming}
                                loadingText="Claiming..."
                                disabled={claimFetcher.state === 'submitting'}
                                onClick={() => {
                                  setClaimingOrderId(order.id);
                                  claimFetcher.submit(
                                    { intent: 'claimOrder', orderId: order.id },
                                    { method: 'post' },
                                  );
                                }}
                              >
                                Claim
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </DeferredSection>
      )}

      {/* ── Performance Tab ─────────────────────────── */}
      {activeTab === 'performance' && (
        <DeferredSection resolve={leaderboard} skeleton="table">
          {(lb: CSLeaderboardEntry[]) => {
            if (lb.length === 0) return null;
            return (
              <div className="card p-0 overflow-hidden flex flex-col h-[28rem]">
                <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800 shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-surface-900 dark:text-white">CS Agent Performance</h3>
                      <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                        Ranked by delivery rate ({leaderboardPeriod === 'all_time' ? 'all time' : 'this month'})
                      </p>
                    </div>
                    <div className="flex gap-1 rounded-lg bg-surface-100 dark:bg-surface-800 p-1">
                      <Link
                        to="/admin/cs/queue?period=this_month"
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          leaderboardPeriod === 'this_month'
                            ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                            : 'text-surface-700 dark:text-surface-200 hover:text-surface-900 dark:hover:text-surface-200'
                        }`}
                      >
                        This month
                      </Link>
                      <Link
                        to="/admin/cs/queue?period=all_time"
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          leaderboardPeriod === 'all_time'
                            ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                            : 'text-surface-700 dark:text-surface-200 hover:text-surface-900 dark:hover:text-surface-200'
                        }`}
                      >
                        All time
                      </Link>
                    </div>
                  </div>
                </div>
                <div className="hidden md:block overflow-auto flex-1 min-h-0">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header">#</th>
                        <th className="table-header">Agent</th>
                        <th className="table-header text-right">Engaged</th>
                        <th className="table-header text-right">Confirmed</th>
                        <th className="table-header text-right">Delivered</th>
                        <th className="table-header text-right">Calls</th>
                        <th className="table-header text-right">Conf. Rate</th>
                        <th className="table-header text-right">Del. Rate</th>
                        <th className="table-header text-right">Avg Call</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lb.map((e: CSLeaderboardEntry, idx: number) => (
                        <tr key={e.agentId} className="table-row">
                          <td className="table-cell text-surface-700 dark:text-surface-300 font-mono text-sm">{idx + 1}</td>
                          <td className="table-cell">
                            <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{e.agentName}</p>
                          </td>
                          <td className="table-cell text-right text-sm">{e.ordersEngaged}</td>
                          <td className="table-cell text-right text-sm text-success-600 dark:text-success-400">{e.ordersConfirmed}</td>
                          <td className="table-cell text-right text-sm font-medium text-brand-600 dark:text-brand-400">{e.ordersDelivered}</td>
                          <td className="table-cell text-right text-sm">{e.callsMade}</td>
                          <td className="table-cell text-right text-sm">{e.confirmationRate.toFixed(1)}%</td>
                          <td className="table-cell text-right">
                            <span className={`text-sm font-bold ${e.deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' : e.deliveryRate >= 50 ? 'text-warning-600 dark:text-warning-400' : 'text-surface-900 dark:text-white'}`}>
                              {e.deliveryRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="table-cell text-right text-sm text-surface-700 dark:text-surface-300">
                            {e.avgCallDurationSeconds >= 60
                              ? `${Math.floor(e.avgCallDurationSeconds / 60)}m ${e.avgCallDurationSeconds % 60}s`
                              : `${e.avgCallDurationSeconds}s`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile — cards */}
                <div className="md:hidden overflow-auto flex-1 min-h-0 p-3 space-y-3">
                  {lb.map((e: CSLeaderboardEntry, idx: number) => (
                    <div
                      key={e.agentId}
                      className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-surface-700 dark:text-surface-300">#{idx + 1}</span>
                          <span className="font-medium text-surface-900 dark:text-white text-sm">{e.agentName}</span>
                        </div>
                        <span className={`text-sm font-bold ${e.deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' : e.deliveryRate >= 50 ? 'text-warning-600 dark:text-warning-400' : 'text-surface-900 dark:text-white'}`}>
                          {e.deliveryRate.toFixed(1)}% del.
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-surface-700 dark:text-surface-300">Confirmed</span>
                          <p className="font-medium text-surface-900 dark:text-white">{e.ordersConfirmed}</p>
                        </div>
                        <div>
                          <span className="text-surface-700 dark:text-surface-300">Calls</span>
                          <p className="font-medium text-surface-900 dark:text-white">{e.callsMade}</p>
                        </div>
                        <div>
                          <span className="text-surface-700 dark:text-surface-300">Conf. Rate</span>
                          <p className="font-medium text-surface-900 dark:text-white">{e.confirmationRate.toFixed(1)}%</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }}
        </DeferredSection>
      )}

      {/* ── Callbacks Tab ──────────────────────────── */}
      {activeTab === 'callbacks' && (
        <DeferredSection resolve={callbackOrders} skeleton="table">
          {(resolvedCallbacks: CSOrder[]) => (
            <div className="h-[28rem] overflow-auto">
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Callback Queue</h2>
                    <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
                      Orders awaiting callback retry after &ldquo;No Answer&rdquo;
                    </p>
                  </div>
                </div>

                {resolvedCallbacks.length === 0 ? (
                  <div className="text-center py-12 text-surface-700 dark:text-surface-300">
                    No callbacks scheduled
                  </div>
                ) : (
                  <div className="space-y-3">
                    {resolvedCallbacks.map((order: CSOrder) => {
                      const isDue = order.callbackScheduledAt && new Date(order.callbackScheduledAt) <= new Date();
                      const agent = workloads.find((w: AgentWorkload) => w.agentId === order.assignedCsId);
                      return (
                        <div
                          key={order.id}
                          className={`rounded-lg border p-4 ${
                            isDue
                              ? 'border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/10'
                              : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Link
                                  to={`/admin/orders/${order.id}`}
                                  className="text-brand-500 hover:text-brand-600 font-medium text-sm"
                                >
                                  {order.id.slice(0, 8)}...
                                </Link>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400">
                                  Attempt {order.callbackAttempts ?? 0}/3
                                </span>
                                {isDue && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400">
                                    DUE NOW
                                  </span>
                                )}
                              </div>
                              <p className="text-sm font-medium text-surface-900 dark:text-surface-100">
                                {order.customerName}
                              </p>
                              <p className="text-xs text-surface-800 dark:text-surface-200">
                                {order.customerPhoneDisplay}
                                {agent ? ` \u00b7 Assigned: ${agent.agentName}` : ''}
                                {order.totalAmount ? ` \u00b7 \u20A6${Number(order.totalAmount).toLocaleString()}` : ''}
                              </p>
                              {order.callbackScheduledAt && (
                                <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                                  Scheduled: {new Date(order.callbackScheduledAt).toLocaleString('en-NG', {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                  })}
                                </p>
                              )}
                              {order.callbackNotes && (
                                <p className="text-xs text-surface-800 dark:text-surface-200 mt-1 italic">
                                  Note: {order.callbackNotes}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Link
                                to={`/admin/orders/${order.id}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                View
                              </Link>
                              <Link
                                to={`/admin/orders/${order.id}`}
                                className="btn-primary btn-sm"
                              >
                                Call Now
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            </div>
          )}
        </DeferredSection>
      )}

      {/* ── Duplicates warning (shown when Active Orders tab is active) ─── */}
      {activeTab === 'active' && (
        <DeferredSection resolve={flaggedDuplicates} skeleton="inline">
          {(pairs: DuplicatePair[]) =>
            pairs.length > 0 ? (
              <div className="card border-danger-200 dark:border-danger-800 bg-danger-50/40 dark:bg-danger-900/10">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-danger-100 dark:bg-danger-900/30 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-danger-700 dark:text-danger-400">
                      {pairs.length} potential duplicate{pairs.length > 1 ? 's' : ''} detected
                    </p>
                    <div className="mt-2 space-y-2">
                      {pairs.slice(0, 3).map((pair: DuplicatePair) => (
                        <div key={pair.duplicate.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-surface-700 dark:text-surface-300 truncate">
                            {pair.duplicate.customerName} — #{pair.duplicate.id.slice(0, 8)}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              className="text-[11px] px-2 py-0.5 h-auto"
                              onClick={() => fetcher.submit(
                                { intent: 'mergeDuplicate', duplicateId: pair.duplicate.id, originalId: pair.original?.id ?? '' },
                                { method: 'post' },
                              )}
                              disabled={!pair.original || fetcher.state !== 'idle'}
                            >
                              Merge
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="text-[11px] px-2 py-0.5 h-auto"
                              onClick={() => fetcher.submit(
                                { intent: 'dismissDuplicate', orderId: pair.duplicate.id },
                                { method: 'post' },
                              )}
                              disabled={fetcher.state !== 'idle'}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      ))}
                      {pairs.length > 3 && (
                        <p className="text-[11px] text-danger-600 dark:text-danger-400">+{pairs.length - 3} more duplicates</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null
          }
        </DeferredSection>
      )}

      {/* ── Delete abandoned cart confirmation ─── */}
      {deleteCartConfirm && (
        <Modal open onClose={() => setDeleteCartConfirm(null)} maxWidth="max-w-sm" contentClassName="p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-danger-100 dark:bg-danger-900/30 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-surface-900 dark:text-white">Delete abandoned cart?</h3>
              <p className="text-sm text-surface-700 dark:text-surface-300 mt-1">
                This will permanently remove <span className="font-medium text-surface-900 dark:text-surface-100">{deleteCartConfirm.customerName}</span>'s cart entry. This cannot be undone.
              </p>
            </div>
          </div>
          <deleteCartFetcher.Form method="post" action="/admin/cs/queue/carts" className="flex items-center justify-end gap-2">
            <input type="hidden" name="intent" value="deleteAbandoned" />
            <input type="hidden" name="cartId" value={deleteCartConfirm.id} />
            <Button type="button" variant="secondary" size="sm" onClick={() => setDeleteCartConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="sm"
              disabled={deleteCartFetcher.state !== 'idle'}
            >
              {deleteCartFetcher.state !== 'idle' ? 'Deleting…' : 'Delete'}
            </Button>
          </deleteCartFetcher.Form>
        </Modal>
      )}

      {/* ── Reassign order modal ───────────────── */}
      {reassignOrder && (
        <Modal open onClose={() => { setReassignOrder(null); setReassignToAgentId(''); }} maxWidth="max-w-md" contentClassName="p-6">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">
              Reassign order
            </h3>
            <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
              {reassignOrder.customerName} ({reassignOrder.orderId.slice(0, 8)}...)
            </p>

            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Assign to agent
              </label>
              <select
                value={reassignToAgentId}
                onChange={(e) => setReassignToAgentId(e.target.value)}
                className="input"
              >
                <option value="">Select agent...</option>
                {workloads
                  .filter((w: AgentWorkload) => w.agentId !== reassignOrder.assignedCsId && w.pendingCount < w.capacity)
                  .map((w: AgentWorkload) => (
                    <option key={w.agentId} value={w.agentId}>
                      {w.agentName} ({w.pendingCount}/{w.capacity})
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => {
                  setReassignOrder(null);
                  setReassignToAgentId('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleReassignSubmit}
                disabled={!reassignToAgentId || fetcher.state === 'submitting'}
                loading={fetcher.state === 'submitting'}
                loadingText="Reassigning..."
              >
                Reassign
              </Button>
            </div>
        </Modal>
      )}

      {/* Performance Quick Stats moved into top Overview card */}

      {cancelConfirmOrder && (
        <ConfirmActionModal
          open={!!cancelConfirmOrder}
          onClose={() => setCancelConfirmOrder(null)}
          title="Cancel order?"
          description={
            <>
              Cancel order for <strong>{cancelConfirmOrder.customerName}</strong>? The order will be moved to Cancelled. You can add a reason on the order detail page if needed.
            </>
          }
          confirmLabel="Cancel order"
          variant="danger"
          loading={fetcher.state === 'submitting'}
          onConfirm={() => {
            fetcher.submit(
              {
                intent: 'transition',
                orderId: cancelConfirmOrder.orderId,
                newStatus: 'CANCELLED',
                reason: 'Cancelled by CS from dashboard',
              },
              { method: 'post' },
            );
          }}
        />
      )}

      {/* View all Agent Workloads modal — 20 per page, Prev/Next */}
      {viewAllAgentsOpen && (
        <Modal open onClose={() => setViewAllAgentsOpen(false)} maxWidth="max-w-4xl" role="dialog" aria-labelledby="view-all-agents-title" contentClassName="p-0 max-h-[90dvh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-100 dark:border-surface-800 shrink-0">
              <h2 id="view-all-agents-title" className="text-lg font-semibold text-surface-900 dark:text-white">
                Agent Workloads
              </h2>
              <button
                type="button"
                onClick={() => setViewAllAgentsOpen(false)}
                className="p-2 rounded-lg text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 py-2 border-b border-surface-100 dark:border-surface-800 shrink-0">
              <p className="text-sm text-surface-600 dark:text-surface-400">
                {workloads.length} agent{workloads.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {(() => {
                const sorted = [...workloads].sort((a, b) => {
                  const aNew = newAgentIds.has(a.agentId) ? 1 : 0;
                  const bNew = newAgentIds.has(b.agentId) ? 1 : 0;
                  if (aNew !== bNew) return bNew - aNew;
                  const aTime = a.lastActionAt ? new Date(a.lastActionAt).getTime() : 0;
                  const bTime = b.lastActionAt ? new Date(b.lastActionAt).getTime() : 0;
                  return bTime - aTime;
                });
                const pageSize = 20;
                const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
                const page = Math.min(viewAllPage, totalPages);
                const start = (page - 1) * pageSize;
                const rows = sorted.slice(start, start + pageSize);

                return (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                      {rows.map((agent: AgentWorkload) => (
                        <AgentWorkloadCard key={agent.agentId} agent={agent} isNew={newAgentIds.has(agent.agentId)} onOpen={(a) => { setViewAllAgentsOpen(false); setSelectedAgent(a); }} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
                      <span className="text-sm text-surface-600 dark:text-surface-400">
                        Page {page} of {totalPages}
                        {sorted.length > 0 && (
                          <span className="ml-1">
                            ({start + 1}–{Math.min(start + pageSize, sorted.length)} of {sorted.length})
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={page <= 1}
                          onClick={() => setViewAllPage((p) => Math.max(1, p - 1))}
                        >
                          Prev
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={page >= totalPages}
                          onClick={() => setViewAllPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
        </Modal>
      )}
    </div>
  );
}
