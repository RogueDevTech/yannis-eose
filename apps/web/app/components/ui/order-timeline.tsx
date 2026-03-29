import { Link } from '@remix-run/react';
import { EDGE_FORM_ACTOR_ID } from '@yannis/shared';
import type { ReactNode } from 'react';
import type { TimelineEvent } from '~/features/orders/types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function isLinkableUserId(id: string | null | undefined): id is string {
  return id != null && isUuid(id) && id !== EDGE_FORM_ACTOR_ID;
}

function strMeta(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!metadata) return undefined;
  const v = metadata[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function TimelineLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="font-medium text-brand-600 dark:text-brand-400 underline-offset-2 decoration-from-font hover:underline"
    >
      {children}
    </Link>
  );
}

function timelineActorLabel(event: TimelineEvent): string | null {
  if (event.actorName) return event.actorName;
  if (event.actorId === EDGE_FORM_ACTOR_ID) return 'Edge form';
  return null;
}

/** Left border accent per row (no emoji). */
const EVENT_BORDER: Record<string, string> = {
  ORDER_RECEIVED: 'border-brand-400',
  ORDER_AUTO_ASSIGNED: 'border-app-border dark:border-neutral-600',
  ORDER_MANUALLY_ASSIGNED: 'border-app-border dark:border-neutral-600',
  ORDER_REASSIGNED: 'border-app-border dark:border-neutral-600',
  ORDER_CLAIMED: 'border-brand-400',
  ORDER_VIEWED: 'border-app-border dark:border-neutral-600',
  CALL_INITIATED: 'border-brand-400',
  CALL_COMPLETED: 'border-success-500',
  CALL_NO_ANSWER: 'border-amber-500',
  CALL_FAILED: 'border-danger-500',
  MANUAL_CALL_LOGGED: 'border-app-border dark:border-neutral-600',
  SMS_SENT: 'border-brand-400',
  WHATSAPP_SENT: 'border-success-500',
  ORDER_CONFIRMED: 'border-success-500',
  ORDER_CANCELLED: 'border-danger-500',
  ADDRESS_UPDATED: 'border-app-border dark:border-neutral-600',
  QUANTITY_UPDATED: 'border-app-border dark:border-neutral-600',
  CALLBACK_SCHEDULED: 'border-amber-500',
  ORDER_ALLOCATED: 'border-violet-500',
  ORDER_DISPATCHED: 'border-violet-500',
  ORDER_IN_TRANSIT: 'border-violet-500',
  ORDER_DELIVERED: 'border-success-500',
  ORDER_PARTIALLY_DELIVERED: 'border-amber-500',
  ORDER_RETURNED: 'border-amber-500',
  ORDER_RESTOCKED: 'border-app-border dark:border-neutral-600',
  ORDER_WRITTEN_OFF: 'border-danger-500',
  SUPERVISOR_WATCHING: 'border-app-border dark:border-neutral-600',
  PAYMENT_RECEIVED: 'border-success-500',
};

const RIDER_METADATA_EVENT_TYPES = new Set([
  'ORDER_DISPATCHED',
  'ORDER_IN_TRANSIT',
  'ORDER_DELIVERED',
  'ORDER_PARTIALLY_DELIVERED',
  'ORDER_RETURNED',
  'ORDER_RESTOCKED',
  'ORDER_WRITTEN_OFF',
]);

function formatEventType(type: string): string {
  return type
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderTimelineDescription(event: TimelineEvent): ReactNode {
  const m = event.metadata;
  const mbId = strMeta(m, 'mediaBuyerId');
  const mbName = strMeta(m, 'mediaBuyerName');

  if (event.eventType === 'ORDER_RECEIVED' && mbId && isLinkableUserId(mbId)) {
    const suffix = mbName ? ` — attributed to media buyer ${mbName}` : '';
    const base =
      mbName && event.description.endsWith(suffix)
        ? event.description.slice(0, -suffix.length)
        : event.description.split(' — attributed to media buyer ')[0] ?? event.description;
    const label = mbName ?? 'Media buyer';
    return (
      <>
        {base}
        {' — attributed to media buyer '}
        <TimelineLink to={`/hr/users/${mbId}`}>{label}</TimelineLink>
      </>
    );
  }

  if (event.eventType === 'ORDER_AUTO_ASSIGNED') {
    const id = strMeta(m, 'agentId') ?? event.actorId;
    const match = /^Auto-assigned to (.+)$/.exec(event.description);
    const name = match?.[1] ?? event.actorName ?? 'Agent';
    if (isLinkableUserId(id)) {
      return (
        <>
          Auto-assigned to <TimelineLink to={`/hr/users/${id}`}>{name}</TimelineLink>
        </>
      );
    }
  }

  if (event.eventType === 'ORDER_CLAIMED') {
    const id = strMeta(m, 'agentId') ?? event.actorId;
    const match = /^(.+?) claimed this order$/.exec(event.description);
    const name = match?.[1] ?? event.actorName;
    if (name && isLinkableUserId(id)) {
      return (
        <>
          <TimelineLink to={`/hr/users/${id}`}>{name}</TimelineLink> claimed this order
        </>
      );
    }
  }

  if (event.eventType === 'ORDER_MANUALLY_ASSIGNED') {
    const csId = strMeta(m, 'csAgentId');
    const match = /^Assigned to (.+?) by (.+)$/.exec(event.description);
    if (csId && isLinkableUserId(csId) && match) {
      const byPart = match[2];
      const byLink = isLinkableUserId(event.actorId) ? (
        <TimelineLink to={`/hr/users/${event.actorId}`}>{byPart}</TimelineLink>
      ) : (
        byPart
      );
      return (
        <>
          Assigned to <TimelineLink to={`/hr/users/${csId}`}>{match[1]}</TimelineLink>
          {' by '}
          {byLink}
        </>
      );
    }
  }

  if (event.eventType === 'ORDER_REASSIGNED') {
    const toId = strMeta(m, 'toAgentId');
    const match = /^Reassigned to (.+?) by (.+)$/.exec(event.description);
    if (toId && isLinkableUserId(toId) && match) {
      const byPart = match[2];
      const byLink = isLinkableUserId(event.actorId) ? (
        <TimelineLink to={`/hr/users/${event.actorId}`}>{byPart}</TimelineLink>
      ) : (
        byPart
      );
      return (
        <>
          Reassigned to <TimelineLink to={`/hr/users/${toId}`}>{match[1]}</TimelineLink>
          {' by '}
          {byLink}
        </>
      );
    }
  }

  if (event.eventType === 'SMS_SENT' || event.eventType === 'WHATSAPP_SENT') {
    const templateId = strMeta(m, 'templateId');
    if (templateId && isUuid(templateId)) {
      return (
        <>
          {event.description}{' '}
          (<TimelineLink to="/admin/cs/message-templates">message template</TimelineLink>)
        </>
      );
    }
  }

  if (RIDER_METADATA_EVENT_TYPES.has(event.eventType)) {
    const riderId = strMeta(m, 'riderId');
    if (riderId && isLinkableUserId(riderId)) {
      return (
        <>
          {event.description}{' '}
          — <TimelineLink to={`/hr/users/${riderId}`}>Rider profile</TimelineLink>
        </>
      );
    }
  }

  return event.description;
}

interface OrderTimelineProps {
  events: TimelineEvent[];
}

export function OrderTimeline({ events }: OrderTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-app-fg-muted">
        No timeline events yet.
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {events.map((event) => {
        const borderClass =
          EVENT_BORDER[event.eventType] ?? 'border-app-border dark:border-neutral-600';
        const actorLabel = timelineActorLabel(event);
        const description = renderTimelineDescription(event);
        const actorLinkable = isLinkableUserId(event.actorId);
        // Description already names the actor, or actor equals assignee/claimer.
        const showActorLine =
          actorLabel &&
          event.eventType !== 'ORDER_AUTO_ASSIGNED' &&
          event.eventType !== 'ORDER_CLAIMED' &&
          event.eventType !== 'ORDER_MANUALLY_ASSIGNED' &&
          event.eventType !== 'ORDER_REASSIGNED';

        return (
          <li
            key={event.id}
            className={`border-l-4 pl-3 py-0.5 ${borderClass}`}
            title={formatEventType(event.eventType)}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-sm font-medium text-app-fg leading-tight">{description}</span>
              {showActorLine && (
                <span className="text-xs text-app-fg-muted">
                  by{' '}
                  {actorLinkable ? (
                    <TimelineLink to={`/hr/users/${event.actorId}`}>{actorLabel}</TimelineLink>
                  ) : (
                    actorLabel
                  )}
                </span>
              )}
            </div>
            <time dateTime={event.createdAt} className="text-xs text-app-fg-muted">
              {new Date(event.createdAt).toLocaleString('en-NG', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
