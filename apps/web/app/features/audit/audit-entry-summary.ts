/**
 * Plain-language audit row summaries for the audit UI and CSV export.
 * Fold INSERT/UPDATE/DELETE into the sentence (no separate Action column).
 */
import { EDGE_FORM_ACTOR_ID } from '@yannis/shared';
import { formatNaira } from '~/lib/format-amount';
import type { ActorMap, AuditEntry } from './types';

/** Read the first present field from history payloads (snake_case vs camelCase). */
export function pickDataField(data: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (!(k in data)) continue;
    const v = data[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  for (const k of keys) {
    if (k in data) return data[k];
  }
  return undefined;
}

function pickStr(data: Record<string, unknown>, ...keys: string[]): string | null {
  const v = pickDataField(data, ...keys);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function pickNum(data: Record<string, unknown>, ...keys: string[]): string | number | null {
  const v = pickDataField(data, ...keys);
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.length > 0 && !Number.isNaN(Number(v))) return v;
  return null;
}

export const AUDIT_TABLE_LABELS: Record<string, string> = {
  users: 'Users',
  products: 'Products',
  product_categories: 'Product Categories',
  stock_batches: 'Stock Batches',
  logistics_providers: 'Logistics companies',
  logistics_locations: 'Logistics Locations',
  inventory_levels: 'Inventory Levels',
  offer_templates: 'Offer Templates',
  campaigns: 'Campaigns',
  orders: 'Orders',
  order_items: 'Order Items',
  stock_transfers: 'Stock Transfers',
  stock_movements: 'Stock Movements',
  marketing_funding: 'Marketing Funding',
  marketing_funding_requests: 'Marketing Funding Requests',
  ad_spend_logs: 'Ad Spend Logs',
  call_logs: 'Call Logs',
  invoices: 'Invoices',
  approval_requests: 'Approval Requests',
  delivery_confirmation_requests: 'Delivery Confirmation Requests',
  budgets: 'Budgets',
  settlement_configs: 'Settlement Configs',
  commission_plans: 'Commission Plans',
  payout_records: 'Payout Records',
  earnings_adjustments: 'Earnings Adjustments',
  stock_reconciliations: 'Stock Reconciliations',
  email_change_requests: 'Email Change Requests',
  user_product_assignments: 'User Product Assignments',
  permission_requests: 'Permission Requests',
  system_settings: 'System Settings',
  cart_abandonments: 'Cart Abandonments',
  permissions: 'Permissions',
  user_permissions: 'User Permissions',
  mirror_sessions: 'Mirror sessions',
};

export function formatAuditTableName(name: string): string {
  return AUDIT_TABLE_LABELS[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Role chips in summaries — mirror AuditPage structured display. */
export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  HEAD_OF_MARKETING: 'Head of Marketing',
  MEDIA_BUYER: 'Media Buyer',
  HEAD_OF_CS: 'Head of CS',
  CS_CLOSER: 'CS Closer',
  FINANCE_OFFICER: 'Finance Officer',
  HEAD_OF_LOGISTICS: 'Head of Logistics',
  STOCK_MANAGER: 'Stock Manager',
  TPL_MANAGER: '3PL Manager',
  TPL_RIDER: '3PL Rider',
  HR_MANAGER: 'HR Manager',
};

export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ARCHIVED: 'Archived',
  UNPROCESSED: 'Unassigned',
  CS_ASSIGNED: 'Assigned',
  CS_ENGAGED: 'Unconfirmed',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  AGENT_ASSIGNED: 'Agent assigned',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  PARTIALLY_DELIVERED: 'Partially Delivered',
  RETURNED: 'Returned',
  RESTOCKED: 'Restocked',
  WRITTEN_OFF: 'Written Off',
  REMITTED: 'Remitted',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  DRAFT: 'Draft',
  SENT: 'Sent',
  DISPUTED: 'Disputed',
  RECEIVED: 'Received',
  OVERDUE: 'Overdue',
  PENDING_APPROVAL: 'Pending Approval',
  QUERIED: 'Queried',
  ACCEPTED: 'Accepted',
  INITIATED: 'Initiated',
  RINGING: 'Ringing',
  IN_PROGRESS: 'In Progress',
  FAILED: 'Failed',
  NO_ANSWER: 'No Answer',
  BUSY: 'Busy',
  MANUAL_CALL: 'Manual Call',
  RESOLVED: 'Resolved',
};

const PERMISSION_REQUEST_TYPE_PHRASES: Record<string, string> = {
  USER_CREATION: 'add a new team member',
  ROLE_CHANGE: "change someone's role",
  PERMISSION_GRANT: 'grant extra access',
  PRODUCT_ARCHIVE: 'archive a product',
  ORDER_LINE_PRICE_CHANGE: 'change prices on an order line',
  ORDER_DELETION: 'archive an order',
};

export function resolveActor(
  map: ActorMap,
  userId: string,
  asOf: string,
): { name: string; role: string; nameNow: string; roleNow: string; isHistorical: boolean } | null {
  const entry = map[userId];
  if (!entry) return null;
  for (const version of entry.history) {
    const inRange = version.validFrom <= asOf && (version.validTo === null || asOf < version.validTo);
    if (inRange) {
      const isHistorical = version.validTo !== null;
      return {
        name: version.name,
        role: version.role,
        nameNow: entry.nameNow,
        roleNow: entry.roleNow,
        isHistorical: isHistorical || version.name !== entry.nameNow || version.role !== entry.roleNow,
      };
    }
  }
  return { name: entry.nameNow, role: entry.roleNow, nameNow: entry.nameNow, roleNow: entry.roleNow, isHistorical: false };
}

export function getActorDisplay(changedBy: string | null, actorNames: ActorMap, asOf: string): string {
  if (!changedBy) return 'System';
  if (changedBy === EDGE_FORM_ACTOR_ID) return 'Edge Form';
  const actor = resolveActor(actorNames, changedBy, asOf);
  if (!actor) return `${changedBy.slice(0, 8)}…`;
  return actor.isHistorical ? `${actor.name} (now ${actor.nameNow})` : actor.name;
}

export function isActorKnown(changedBy: string | null, actorNames: ActorMap): boolean {
  if (!changedBy) return false;
  return !!actorNames[changedBy];
}

export function lookupName(value: unknown, actorNames: ActorMap, asOf: string): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const actor = resolveActor(actorNames, value, asOf);
  return actor?.name ?? null;
}

function formatCurrency(val: unknown): string {
  const num = Number(val);
  if (Number.isNaN(num)) return String(val);
  return formatNaira(num, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function genericTableVerb(action: AuditEntry['action']): string {
  switch (action) {
    case 'INSERT':
      return 'Added';
    case 'DELETE':
      return 'Removed';
    default:
      return 'Changed';
  }
}

export interface AuditSummaryParts {
  prefix: string;
  entityLabel: string | null;
  suffix: string;
}

function resolveLocationAuditLabel(locationId: string | null, locationNames?: Record<string, string>): string {
  if (!locationId) return '';
  const name = locationNames?.[locationId];
  if (name && name.trim().length > 0) return name;
  return `${locationId.slice(0, 8)}…`;
}

/** Parsed description segments for clickable warehouse-transfer audit rows */
export type AuditDescriptionPiece =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string; variant: 'fromLoc' | 'toLoc' | 'transfer' };

function appendWarehouseTransferGeoLinks(
  pieces: AuditDescriptionPiece[],
  entry: AuditEntry,
  fromId: string | null,
  toId: string | null,
  locationNames: Record<string, string>,
  tailQty: string | null,
): void {
  pieces.push({ kind: 'text', text: ' from ' });
  if (fromId) {
    pieces.push({
      kind: 'link',
      text: resolveLocationAuditLabel(fromId, locationNames),
      href: `/admin/transfers?fromLocationId=${encodeURIComponent(fromId)}`,
      variant: 'fromLoc',
    });
  } else {
    pieces.push({ kind: 'text', text: 'unknown origin' });
  }
  pieces.push({ kind: 'text', text: ' to ' });
  if (toId) {
    pieces.push({
      kind: 'link',
      text: resolveLocationAuditLabel(toId, locationNames),
      href: `/admin/transfers?toLocationId=${encodeURIComponent(toId)}`,
      variant: 'toLoc',
    });
  } else {
    pieces.push({ kind: 'text', text: 'unknown destination' });
  }
  if (tailQty) pieces.push({ kind: 'text', text: ` — ${tailQty}` });
  pieces.push({ kind: 'text', text: '.' });
  pieces.push({ kind: 'text', text: ' ' });
  pieces.push({
    kind: 'link',
    text: 'Open transfer',
    href: `/admin/transfers?transferId=${encodeURIComponent(entry.recordId)}`,
    variant: 'transfer',
  });
}

/**
 * Warehouse transfer rows render as linked segments (locations + open transfer) in the audit UI.
 */
export function getAuditDescriptionPieces(
  entry: AuditEntry,
  actorNames: ActorMap,
  locationNames: Record<string, string>,
): AuditDescriptionPiece[] | null {
  if (entry.tableName !== 'stock_transfers') return null;

  const data = entry.data;
  const actor = getActorDisplay(entry.changedBy, actorNames, entry.validFrom);
  const status = pickStr(data, 'transfer_status', 'transferStatus');
  const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
  const fromId = pickStr(data, 'from_location_id', 'fromLocationId');
  const toId = pickStr(data, 'to_location_id', 'toLocationId');
  const sentQty = pickNum(data, 'sent_quantity', 'sentQuantity');
  const receivedQty = pickNum(data, 'received_quantity', 'receivedQuantity');
  const qtyStr = sentQty != null ? String(sentQty) : '';

  const pieces: AuditDescriptionPiece[] = [];

  if (status === 'RECEIVED') {
    const received = receivedQty != null ? String(receivedQty) : qtyStr;
    pieces.push({
      kind: 'text',
      text: `${actor} confirmed receipt of a warehouse transfer`,
    });
    appendWarehouseTransferGeoLinks(
      pieces,
      entry,
      fromId,
      toId,
      locationNames,
      received ? `${received} units` : null,
    );
    return pieces;
  }

  if (status === 'DISPUTED') {
    pieces.push({ kind: 'text', text: `${actor} disputed a warehouse transfer` });
    appendWarehouseTransferGeoLinks(pieces, entry, fromId, toId, locationNames, qtyStr ? `${qtyStr} units` : null);
    return pieces;
  }

  if (status === 'CANCELLED') {
    pieces.push({
      kind: 'text',
      text: `${actor} cancelled a warehouse transfer${statusLabel ? ` (${statusLabel})` : ''}`,
    });
    appendWarehouseTransferGeoLinks(
      pieces,
      entry,
      fromId,
      toId,
      locationNames,
      qtyStr ? `${qtyStr} units` : null,
    );
    return pieces;
  }

  const verb = entry.action === 'INSERT' ? 'created' : 'updated';
  const mid = statusLabel ? ` (${statusLabel})` : '';
  pieces.push({
    kind: 'text',
    text: `${actor} ${verb} a warehouse transfer${mid}`,
  });
  appendWarehouseTransferGeoLinks(
    pieces,
    entry,
    fromId,
    toId,
    locationNames,
    qtyStr ? `${qtyStr} units` : null,
  );
  return pieces;
}

export function getAuditSummaryParts(
  entry: AuditEntry,
  actorNames: ActorMap,
  locationNames?: Record<string, string>,
): AuditSummaryParts {
  const data = entry.data;
  const table = entry.tableName;
  const asOf = entry.validFrom;
  const actor = getActorDisplay(entry.changedBy, actorNames, asOf);

  const recordLabel = pickStr(
    data,
    'name',
    'customer_name',
    'plan_name',
    'campaign_name',
    'reference_number',
    'batch_number',
    'email',
  );

  if (table === 'mirror_sessions') {
    const targetId = pickStr(data, 'target_id', 'targetId');
    const targetInfo = targetId ? resolveActor(actorNames, targetId, asOf) : null;
    const targetLabel = targetInfo?.name ?? (targetId ? `${targetId.slice(0, 8)}…` : 'another user');
    const isActive = entry.action === 'INSERT';
    if (isActive) {
      return { prefix: `${actor} opened a read-only session as `, entityLabel: targetLabel, suffix: '.' };
    }
    const startedRaw = pickStr(data, 'started_at', 'startedAt');
    const endedRaw = pickStr(data, 'ended_at', 'endedAt');
    let durationLabel = '';
    if (startedRaw && endedRaw) {
      const ms = new Date(endedRaw).getTime() - new Date(startedRaw).getTime();
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      durationLabel = mins > 0 ? ` (session lasted ${mins}m ${secs}s).` : ` (session lasted ${secs}s).`;
    } else {
      durationLabel = '.';
    }
    return { prefix: `${actor} ended a read-only session as `, entityLabel: targetLabel, suffix: durationLabel };
  }

  if (table === 'users') {
    const roleRaw = pickStr(data, 'role');
    const role = roleRaw ? (ROLE_LABELS[roleRaw] ?? roleRaw) : '';
    const status = pickStr(data, 'status');
    const suffix = role ? ` as ${role}.` : '.';
    if (entry.action === 'INSERT') return { prefix: `${actor} added `, entityLabel: recordLabel, suffix };
    if (status === 'INACTIVE') return { prefix: `${actor} deactivated `, entityLabel: recordLabel, suffix: '.' };
    if (status === 'ARCHIVED') return { prefix: `${actor} archived `, entityLabel: recordLabel, suffix: '.' };
    return { prefix: `${actor} updated `, entityLabel: recordLabel, suffix: '.' };
  }

  if (table === 'orders') {
    const status = pickStr(data, 'order_status', 'orderStatus');
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const customer = pickStr(data, 'customer_name', 'customerName');
    const ref = pickStr(data, 'reference_number', 'referenceNumber');
    const who = customer ?? ref;
    const customerPhrase = customer ? ` for ${customer}` : '';

    if (status === 'UNPROCESSED') {
      if (!who) return { prefix: `${actor} recorded a new order.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} recorded a new order for `, entityLabel: who, suffix: '.' };
    }
    if (status === 'CS_ASSIGNED') {
      if (!who) return { prefix: `${actor} assigned a sales closer to the order.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} assigned a sales closer for `, entityLabel: who, suffix: '.' };
    }
    if (status === 'CS_ENGAGED') {
      if (!who) return { prefix: `${actor} started working on the order.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} started working on the order for `, entityLabel: who, suffix: '.' };
    }
    if (status === 'CONFIRMED') {
      if (!who) return { prefix: `${actor} confirmed the order.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} confirmed the order for `, entityLabel: who, suffix: '.' };
    }
    if (status === 'CANCELLED') {
      const reasonRaw = pickStr(data, 'cancel_reason', 'cancelReason');
      const reason = reasonRaw ? ` (${reasonRaw})` : '';
      if (!who) return { prefix: `${actor} cancelled the order${reason}.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} cancelled the order for `, entityLabel: who, suffix: `${reason}.` };
    }
    if (status === 'AGENT_ASSIGNED') {
      if (!who) return { prefix: `${actor} shared the order with a logistics company.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} shared the order with a logistics company (`, entityLabel: who, suffix: ').' };
    }
    if (status === 'DISPATCHED') {
      if (!who) return { prefix: `${actor} marked the order dispatched.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} marked the order dispatched (`, entityLabel: who, suffix: ').' };
    }
    if (status === 'IN_TRANSIT') {
      return {
        prefix: `The order${customerPhrase} was marked in transit.`,
        entityLabel: null,
        suffix: '',
      };
    }
    if (status === 'DELIVERED') {
      if (!who) return { prefix: `${actor} marked the order delivered.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} marked the order delivered (`, entityLabel: who, suffix: ').' };
    }
    if (status === 'PARTIALLY_DELIVERED') {
      if (!who) return { prefix: `${actor} marked the order partially delivered.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} marked the order partially delivered (`, entityLabel: who, suffix: ').' };
    }
    if (status === 'RETURNED') {
      if (!who) return { prefix: `${actor} marked the order returned.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} marked the order returned (`, entityLabel: who, suffix: ').' };
    }
    if (status === 'RESTOCKED') {
      if (!who) return { prefix: `${actor} restocked units from a returned order.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} restocked units from a returned order (`, entityLabel: who, suffix: ').' };
    }
    if (status === 'WRITTEN_OFF') {
      if (!who) return { prefix: `${actor} wrote off the order.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} wrote off the order (`, entityLabel: who, suffix: ').' };
    }
    if (status === 'REMITTED') {
      if (!who) return { prefix: `${actor} recorded remittance for the order.`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} recorded remittance for `, entityLabel: who, suffix: '.' };
    }
    if (statusLabel) {
      if (!who) return { prefix: `${actor} updated the order (status: ${statusLabel}).`, entityLabel: null, suffix: '' };
      return { prefix: `${actor} updated the order for `, entityLabel: who, suffix: ` (status: ${statusLabel}).` };
    }
    if (!who) return { prefix: `${actor} updated the order.`, entityLabel: null, suffix: '' };
    return { prefix: `${actor} updated the order for `, entityLabel: who, suffix: '.' };
  }

  if (table === 'order_items') {
    const qty = pickNum(data, 'quantity', 'qty');
    const priceRaw = pickDataField(data, 'unit_price', 'unitPrice');
    const qtyStr = qty != null ? String(qty) : '';
    const price = priceRaw != null && priceRaw !== '' ? formatCurrency(priceRaw) : '';
    const detail =
      qtyStr && price ? `${qtyStr} units at ${price}` : qtyStr ? `${qtyStr} units` : price ? `${price} each` : '';
    const verb = entry.action === 'INSERT' ? 'added' : entry.action === 'DELETE' ? 'removed' : 'updated';
    const full = detail ? `${actor} ${verb} a line on an order (${detail}).` : `${actor} ${verb} a line on an order.`;
    return { prefix: full, entityLabel: null, suffix: '' };
  }

  if (table === 'product_categories') {
    const brand = pickStr(data, 'brand_name', 'brandName');
    const brandSuffix = brand ? ` (brand: ${brand}).` : '.';
    const verb = entry.action === 'INSERT' ? 'created' : 'updated';
    return { prefix: `${actor} ${verb} a product category `, entityLabel: recordLabel, suffix: brandSuffix };
  }

  if (table === 'products') {
    const priceVal = pickDataField(data, 'baseSalePrice', 'base_sale_price');
    const price = priceVal != null && priceVal !== '' ? ` (${formatCurrency(priceVal)}).` : '.';
    const inactive =
      pickStr(data, 'status') === 'INACTIVE' || pickDataField(data, 'is_active', 'isActive') === false;
    if (entry.action === 'INSERT') return { prefix: `${actor} added a product `, entityLabel: recordLabel, suffix: price };
    if (inactive) return { prefix: `${actor} deactivated a product `, entityLabel: recordLabel, suffix: price };
    return { prefix: `${actor} updated a product `, entityLabel: recordLabel, suffix: price };
  }

  if (table === 'stock_transfers') {
    const status = pickStr(data, 'transfer_status', 'transferStatus');
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const sentQty = pickNum(data, 'sent_quantity', 'sentQuantity');
    const receivedQty = pickNum(data, 'received_quantity', 'receivedQuantity');
    const qtyStr = sentQty != null ? String(sentQty) : '';
    const fromId = pickStr(data, 'from_location_id', 'fromLocationId');
    const toId = pickStr(data, 'to_location_id', 'toLocationId');
    const fromLm = resolveLocationAuditLabel(fromId, locationNames);
    const toLm = resolveLocationAuditLabel(toId, locationNames);
    const routePhrase =
      fromLm && toLm ? `from ${fromLm} to ${toLm}` : fromLm ? `from ${fromLm}` : toLm ? `to ${toLm}` : '';

    if (status === 'RECEIVED') {
      const received = receivedQty != null ? String(receivedQty) : qtyStr;
      const qtyPart = received ? `${received} units` : '';
      const detailParts = [routePhrase, qtyPart].filter((p) => p.length > 0);
      const detail = detailParts.length > 0 ? ` (${detailParts.join(' · ')})` : '';
      return {
        prefix: `${actor} confirmed receipt of a warehouse transfer${detail}`,
        entityLabel: null,
        suffix: '.',
      };
    }
    if (status === 'DISPUTED') {
      const detailParts = [routePhrase, qtyStr ? `${qtyStr} units sent` : ''].filter((p) => p.length > 0);
      const detail = detailParts.length > 0 ? ` (${detailParts.join(' · ')})` : '';
      return {
        prefix: `${actor} disputed a warehouse transfer${detail}`,
        entityLabel: null,
        suffix: '.',
      };
    }
    if (status === 'CANCELLED') {
      const detailParts = [routePhrase, qtyStr ? `${qtyStr} units` : ''].filter((p) => p.length > 0);
      const detail = detailParts.length > 0 ? ` (${detailParts.join(' · ')})` : '';
      return {
        prefix: `${actor} cancelled a warehouse transfer${detail}`,
        entityLabel: null,
        suffix: '.',
      };
    }
    const verb = entry.action === 'INSERT' ? 'created' : 'updated';
    const mid = statusLabel ? ` (${statusLabel})` : '';
    const qtyPart = qtyStr ? ` — ${qtyStr} units` : '';
    const routeSeg = routePhrase ? ` · ${routePhrase}` : '';
    return { prefix: `${actor} ${verb} a warehouse transfer${mid}${qtyPart}${routeSeg}.`, entityLabel: null, suffix: '' };
  }

  if (table === 'logistics_providers') {
    const verb = entry.action === 'INSERT' ? 'added' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return { prefix: `${actor} ${verb} a logistics company `, entityLabel: recordLabel, suffix: '.' };
  }

  if (table === 'logistics_locations') {
    const verb = entry.action === 'INSERT' ? 'added' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return { prefix: `${actor} ${verb} a logistics location `, entityLabel: recordLabel, suffix: '.' };
  }

  if (table === 'invoices') {
    const status = pickStr(data, 'invoice_status', 'invoiceStatus');
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amountRaw = pickDataField(data, 'amount');
    const amount = amountRaw != null && amountRaw !== '' ? ` for ${formatCurrency(amountRaw)}` : '';
    const recipientInfo = pickDataField(data, 'recipient_info', 'recipientInfo') as { name?: string } | undefined;
    const recipient = recipientInfo && typeof recipientInfo.name === 'string' ? recipientInfo.name : '';
    const recipientLine = recipient ? ` to ${recipient}` : '';
    const suffix = `${recipientLine}${amount}${statusLabel ? ` (${statusLabel}).` : '.'}`;
    const verb = entry.action === 'INSERT' ? 'created' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return { prefix: `${actor} ${verb} an invoice `, entityLabel: recordLabel, suffix };
  }

  if (table === 'marketing_funding') {
    const status = pickStr(data, 'funding_status', 'fundingStatus');
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amountRaw = pickDataField(data, 'amount');
    const amount = amountRaw != null && amountRaw !== '' ? ` (${formatCurrency(amountRaw)})` : '';
    const sender = lookupName(pickDataField(data, 'sender_id', 'senderId'), actorNames, asOf);
    const receiver = lookupName(pickDataField(data, 'receiver_id', 'receiverId'), actorNames, asOf);
    const parties =
      sender && receiver ? ` from ${sender} to ${receiver}` : sender ? ` from ${sender}` : receiver ? ` to ${receiver}` : '';
    if (status === 'COMPLETED') {
      return { prefix: `${actor} confirmed marketing funding was received`, entityLabel: null, suffix: `${parties}${amount}.` };
    }
    if (status === 'DISPUTED') {
      return { prefix: `${actor} disputed a marketing funding transfer`, entityLabel: null, suffix: `${parties}${amount}.` };
    }
    const verb = entry.action === 'INSERT' ? 'recorded' : 'updated';
    const tail = statusLabel ? ` (${statusLabel}).` : '.';
    return { prefix: `${actor} ${verb} marketing funding`, entityLabel: null, suffix: `${parties}${amount}${tail}` };
  }

  if (table === 'campaigns' || table === 'offer_templates') {
    const noun = formatAuditTableName(table).toLowerCase();
    const verb = entry.action === 'INSERT' ? 'created' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return { prefix: `${actor} ${verb} a ${noun} `, entityLabel: recordLabel, suffix: '.' };
  }

  if (table === 'commission_plans') {
    const verb = entry.action === 'INSERT' ? 'created' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return { prefix: `${actor} ${verb} a commission plan `, entityLabel: recordLabel, suffix: '.' };
  }

  if (table === 'payout_records') {
    const status = pickStr(data, 'payout_status', 'payoutStatus');
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amountRaw = pickDataField(data, 'net_amount', 'netAmount');
    const amount = amountRaw != null && amountRaw !== '' ? ` (${formatCurrency(amountRaw)})` : '';
    const staffId = pickDataField(data, 'staff_id', 'staffId', 'user_id', 'userId');
    const staff = lookupName(staffId, actorNames, asOf);
    const staffLine = staff ? ` for ${staff}` : '';
    const tail = `${staffLine}${amount}${statusLabel ? ` — ${statusLabel}.` : '.'}`;
    const verb = entry.action === 'INSERT' ? 'created' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return { prefix: `${actor} ${verb} a payout record`, entityLabel: null, suffix: tail };
  }

  if (table === 'earnings_adjustments') {
    const cat = pickStr(data, 'category');
    const catLabel = cat ? cat.charAt(0) + cat.slice(1).toLowerCase() : '';
    const amountRaw = pickDataField(data, 'amount');
    const amount = amountRaw != null && amountRaw !== '' ? ` of ${formatCurrency(amountRaw)}` : '';
    const staffId = pickDataField(data, 'user_id', 'userId', 'staff_id', 'staffId');
    const staff = lookupName(staffId, actorNames, asOf);
    const staffLine = staff ? ` for ${staff}` : '';
    const verb = entry.action === 'INSERT' ? 'recorded' : entry.action === 'DELETE' ? 'removed' : 'updated';
    if (catLabel && entry.action === 'INSERT') {
      return { prefix: `${actor} recorded a ${catLabel} adjustment`, entityLabel: null, suffix: `${staffLine}${amount}.` };
    }
    return { prefix: `${actor} ${verb} an earnings adjustment`, entityLabel: null, suffix: `${staffLine}${amount}.` };
  }

  if (table === 'marketing_funding_requests') {
    const status = pickStr(data, 'funding_request_status', 'fundingRequestStatus', 'status');
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amountRaw = pickDataField(data, 'amount');
    const amount = amountRaw != null && amountRaw !== '' ? ` (${formatCurrency(amountRaw)})` : '';
    const requester = lookupName(pickDataField(data, 'requester_id', 'requesterId'), actorNames, asOf);
    const requesterLine = requester ? ` from ${requester}` : '';
    const verb = entry.action === 'INSERT' ? 'submitted' : 'updated';
    return {
      prefix: `${actor} ${verb} a funding request`,
      entityLabel: null,
      suffix: `${requesterLine}${amount}${statusLabel ? ` (${statusLabel}).` : '.'}`,
    };
  }

  if (table === 'ad_spend_logs') {
    const status = pickStr(data, 'ad_spend_status', 'adSpendStatus', 'status');
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amountRaw = pickDataField(data, 'spend_amount', 'spendAmount');
    const amount = amountRaw != null && amountRaw !== '' ? ` (${formatCurrency(amountRaw)})` : '';
    const verb = entry.action === 'INSERT' ? 'logged' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return {
      prefix: `${actor} ${verb} ad spend`,
      entityLabel: null,
      suffix: `${amount}${statusLabel ? ` (${statusLabel}).` : '.'}`,
    };
  }

  if (table === 'stock_reconciliations') {
    const status = pickStr(data, 'reconciliation_status', 'reconciliationStatus');
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const disc = pickDataField(data, 'discrepancy');
    const discLine = disc != null && disc !== '' ? ` (discrepancy: ${disc})` : '';
    const verb = entry.action === 'INSERT' ? 'started' : 'updated';
    return {
      prefix: `${actor} ${verb} a stock count reconciliation`,
      entityLabel: null,
      suffix: `${discLine}${statusLabel ? ` (${statusLabel}).` : '.'}`,
    };
  }

  if (table === 'approval_requests') {
    const status = pickStr(data, 'approval_status', 'approvalStatus', 'status');
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amountRaw = pickDataField(data, 'amount');
    const amount = amountRaw != null && amountRaw !== '' ? ` (${formatCurrency(amountRaw)})` : '';
    const requester = lookupName(pickDataField(data, 'requester_id', 'requesterId'), actorNames, asOf);
    const approver = lookupName(pickDataField(data, 'approver_id', 'approverId'), actorNames, asOf);
    const parties =
      requester && approver ? ` (${requester} → ${approver})` : requester ? ` (from ${requester})` : approver ? ` (reviewer: ${approver})` : '';
    const verb = entry.action === 'INSERT' ? 'submitted' : 'updated';
    return {
      prefix: `${actor} ${verb} an approval request`,
      entityLabel: null,
      suffix: `${parties}${amount}${statusLabel ? ` (${statusLabel}).` : '.'}`,
    };
  }

  if (table === 'budgets') {
    const amountRaw = pickDataField(data, 'total_budget', 'totalBudget');
    const amount = amountRaw != null && amountRaw !== '' ? ` (${formatCurrency(amountRaw)})` : '';
    const verb = entry.action === 'INSERT' ? 'created' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return { prefix: `${actor} ${verb} a budget`, entityLabel: recordLabel, suffix: `${amount}.` };
  }

  if (table === 'settlement_configs') {
    const verb = entry.action === 'INSERT' ? 'created' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return { prefix: `${actor} ${verb} payroll settlement settings.`, entityLabel: null, suffix: '' };
  }

  if (table === 'email_change_requests') {
    const status = pickStr(data, 'status');
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const verb = entry.action === 'INSERT' ? 'started' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return {
      prefix: `${actor} ${verb} an email change request`,
      entityLabel: null,
      suffix: statusLabel ? ` (${statusLabel}).` : '.',
    };
  }

  if (table === 'user_product_assignments') {
    const verb = entry.action === 'INSERT' ? 'added' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return { prefix: `${actor} ${verb} who may sell a product `, entityLabel: recordLabel, suffix: '.' };
  }

  if (table === 'permission_requests') {
    const status = pickStr(data, 'permission_request_status', 'permissionRequestStatus', 'status');
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const typeRaw = pickStr(data, 'type');
    const typePhrase = typeRaw ? (PERMISSION_REQUEST_TYPE_PHRASES[typeRaw] ?? typeRaw.replace(/_/g, ' ').toLowerCase()) : 'take a sensitive action';
    const requester = lookupName(
      pickDataField(data, 'requested_by', 'requestedBy', 'requester_id', 'requesterId'),
      actorNames,
      asOf,
    );
    const approver = lookupName(pickDataField(data, 'approved_by', 'approvedBy', 'approver_id', 'approverId'), actorNames, asOf);
    const parties =
      requester && approver ? ` (${requester} → ${approver})` : requester ? ` (requested by ${requester})` : '';

    if (entry.action === 'INSERT') {
      return {
        prefix: `${actor} asked for approval to ${typePhrase}`,
        entityLabel: null,
        suffix: `${parties}.`,
      };
    }
    if (status === 'APPROVED') {
      return {
        prefix: `${actor} approved a request to ${typePhrase}`,
        entityLabel: null,
        suffix: `${parties}.`,
      };
    }
    if (status === 'REJECTED') {
      return {
        prefix: `${actor} rejected a request to ${typePhrase}`,
        entityLabel: null,
        suffix: `${parties}.`,
      };
    }
    return {
      prefix: `${actor} updated a permission request about ${typePhrase}`,
      entityLabel: null,
      suffix: `${parties}${statusLabel ? ` (${statusLabel}).` : '.'}`,
    };
  }

  if (table === 'system_settings') {
    const key = pickStr(data, 'key');
    const verb = entry.action === 'INSERT' ? 'added' : entry.action === 'DELETE' ? 'removed' : 'changed';
    return { prefix: `${actor} ${verb} a system setting`, entityLabel: key, suffix: '.' };
  }

  if (table === 'permissions') {
    const code = pickStr(data, 'code');
    const verb = entry.action === 'INSERT' ? 'added' : entry.action === 'DELETE' ? 'removed' : 'updated';
    return { prefix: `${actor} ${verb} a permission`, entityLabel: code, suffix: '.' };
  }

  if (table === 'user_permissions') {
    const verb = entry.action === 'INSERT' ? 'granted' : entry.action === 'DELETE' ? 'revoked' : 'updated';
    return { prefix: `${actor} ${verb} access for someone`, entityLabel: recordLabel, suffix: '.' };
  }

  const label = formatAuditTableName(table);
  const gv = genericTableVerb(entry.action);
  return { prefix: `${actor} ${gv} `, entityLabel: label, suffix: ' entry.' };
}

/** Plain sentence for CSV / modal subtitle (quotes entity when present). */
export function generateAuditDescription(
  entry: AuditEntry,
  actorNames: ActorMap,
  locationNames?: Record<string, string>,
): string {
  const { prefix, entityLabel, suffix } = getAuditSummaryParts(entry, actorNames, locationNames);
  const label = entityLabel ? `"${entityLabel}"` : '';
  return prefix + label + suffix;
}
