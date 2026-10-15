import { sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Customer journey for one order: everything the same customer or the same
 * browser did around it, in time order. Built for disputes like Oct 15 ("my
 * order went to another buyer's form"), where the answer was spread over
 * campaign_views, cart_abandonments, form_submit_attempts, orders and the
 * duplicate-cleanup timeline events, all linkable by the browser session_id.
 *
 * Same customer = phone hash OR last 9 digits (the hash alone misses 803… vs
 * 0803…). Same browser = the session_id the form persists per browser; views
 * and failed submits carry no phone, so they are matched on the browser only.
 *
 * Lead Fortress: no phone (raw or hashed) is returned. Raw digits are only
 * compared inside SQL.
 */

export type CustomerJourneyEventKind = 'VIEW' | 'CART' | 'FAILED_SUBMIT' | 'ORDER' | 'CLEANUP';

export interface CustomerJourneyEvent {
  kind: CustomerJourneyEventKind;
  at: string;
  formName: string | null;
  mediaBuyerName: string | null;
  orderId: string | null;
  orderNumber: number | null;
  /** Order / cart status, or the failed-submit outcome. */
  status: string | null;
  /** View: website the form was on (null before host tracking). Failed submit: reason (field names / message, never typed values). Order: order source. Cleanup: event description. */
  detail: string | null;
  /** True when matched on the same browser session as the anchor order. */
  sameBrowser: boolean;
  /** True for the order the journey was opened from. */
  isAnchor: boolean;
}

export interface CustomerJourney {
  /** False when the anchor order has no browser session (staff-entered, imported, old): only phone matches are shown. */
  hasBrowserSession: boolean;
  windowDays: number;
  events: CustomerJourneyEvent[];
  /** True when the event list was cut at MAX_EVENTS. */
  truncated: boolean;
}

const WINDOW_DAYS = 14;
const MAX_EVENTS = 300;

export async function loadCustomerJourney(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  orderId: string,
  effectiveBranchIds: string[] | null | undefined,
): Promise<CustomerJourney> {
  if (effectiveBranchIds && effectiveBranchIds.length === 0) {
    return { hasBrowserSession: false, windowDays: WINDOW_DAYS, events: [], truncated: false };
  }
  const inScope = (col: SQL): SQL =>
    effectiveBranchIds == null
      ? sql`TRUE`
      : sql`${col} IN (${sql.join(effectiveBranchIds.map((id) => sql`${id}::uuid`), sql`, `)})`;

  const rows = await db.execute<{
    kind: CustomerJourneyEventKind;
    at: Date | string;
    form_name: string | null;
    media_buyer_name: string | null;
    order_id: string | null;
    order_number: number | null;
    status: string | null;
    detail: string | null;
    same_browser: boolean;
    is_anchor: boolean;
    has_session: boolean;
  }>(sql`
    WITH a AS (
      SELECT o.id, o.session_id, o.customer_phone_hash AS hash,
             right(regexp_replace(coalesce(o.customer_phone, ''), '\\D', '', 'g'), 9) AS tail,
             o.created_at - make_interval(days => ${WINDOW_DAYS}) AS t0,
             o.created_at + make_interval(days => ${WINDOW_DAYS}) AS t1
      FROM orders o WHERE o.id = ${orderId}::uuid
    ),
    mo AS (
      SELECT o.id, o.created_at, o.campaign_id, o.media_buyer_id, o.order_number, o.status::text AS status,
             o.order_source, o.branch_id, o.servicing_branch_id,
             (a.session_id IS NOT NULL AND o.session_id = a.session_id) AS same_browser,
             (o.id = a.id) AS is_anchor
      FROM orders o, a
      WHERE o.id = a.id
         OR (o.created_at BETWEEN a.t0 AND a.t1 AND (
              (a.session_id IS NOT NULL AND o.session_id = a.session_id)
              OR (a.hash IS NOT NULL AND o.customer_phone_hash = a.hash)
              OR (length(a.tail) = 9 AND right(regexp_replace(coalesce(o.customer_phone, ''), '\\D', '', 'g'), 9) = a.tail)
            ))
    ),
    e AS (
      SELECT 'VIEW'::text AS kind, v.viewed_at AS at, v.campaign_id, NULL::uuid AS mb_id, NULL::uuid AS order_id,
             NULL::int AS order_number, NULL::text AS status, v.host_domain AS detail,
             TRUE AS same_browser, FALSE AS is_anchor, NULL::uuid AS b1, NULL::uuid AS b2
      FROM campaign_views v, a
      WHERE a.session_id IS NOT NULL AND v.session_id = a.session_id AND v.viewed_at BETWEEN a.t0 AND a.t1
      UNION ALL
      SELECT 'CART', ca.created_at, ca.campaign_id, NULL, ca.converted_order_id, NULL, ca.status::text, NULL,
             (a.session_id IS NOT NULL AND ca.session_id = a.session_id), FALSE, NULL, NULL
      FROM cart_abandonments ca, a
      WHERE ca.created_at BETWEEN a.t0 AND a.t1 AND (
              (a.session_id IS NOT NULL AND ca.session_id = a.session_id)
              OR (a.hash IS NOT NULL AND ca.customer_phone_hash = a.hash)
              OR (length(a.tail) = 9 AND right(regexp_replace(coalesce(ca.customer_phone, ''), '\\D', '', 'g'), 9) = a.tail)
            )
      UNION ALL
      SELECT 'FAILED_SUBMIT', f.attempted_at, f.campaign_id, NULL, NULL, NULL, f.outcome, f.reason,
             TRUE, FALSE, NULL, NULL
      FROM form_submit_attempts f, a
      WHERE a.session_id IS NOT NULL AND f.session_id = a.session_id AND f.attempted_at BETWEEN a.t0 AND a.t1
      UNION ALL
      SELECT 'ORDER', mo.created_at, mo.campaign_id, mo.media_buyer_id, mo.id, mo.order_number, mo.status, mo.order_source,
             mo.same_browser, mo.is_anchor, mo.branch_id, mo.servicing_branch_id
      FROM mo
      UNION ALL
      SELECT 'CLEANUP', te.created_at, mo.campaign_id, mo.media_buyer_id, mo.id, mo.order_number, NULL, te.description,
             mo.same_browser, mo.is_anchor, mo.branch_id, mo.servicing_branch_id
      FROM order_timeline_events te JOIN mo ON mo.id = te.order_id
      WHERE te.event_type = 'ORDER_DUPLICATE_FLAGGED'
    )
    SELECT e.kind, e.at, c.name AS form_name, u.name AS media_buyer_name, e.order_id, e.order_number,
           e.status, e.detail, e.same_browser, e.is_anchor,
           (SELECT a.session_id IS NOT NULL FROM a) AS has_session
    FROM e
    LEFT JOIN campaigns c ON c.id = e.campaign_id
    LEFT JOIN users u ON u.id = coalesce(e.mb_id, c.media_buyer_id)
    WHERE CASE WHEN e.kind IN ('ORDER', 'CLEANUP')
               THEN (${inScope(sql`e.b1`)} OR ${inScope(sql`e.b2`)})
               ELSE ${inScope(sql`c.branch_id`)} END
    ORDER BY e.at DESC
    LIMIT ${MAX_EVENTS + 1}
  `);

  const list = [...rows];
  const truncated = list.length > MAX_EVENTS;
  const events = list
    .slice(0, MAX_EVENTS)
    .reverse()
    .map((r) => ({
      kind: r.kind,
      at: r.at instanceof Date ? r.at.toISOString() : new Date(r.at).toISOString(),
      formName: r.form_name,
      mediaBuyerName: r.media_buyer_name,
      orderId: r.order_id,
      orderNumber: r.order_number == null ? null : Number(r.order_number),
      status: r.status,
      detail: r.detail,
      sameBrowser: !!r.same_browser,
      isAnchor: !!r.is_anchor,
    }));
  return {
    hasBrowserSession: list.length > 0 ? !!list[0]!.has_session : false,
    windowDays: WINDOW_DAYS,
    events,
    truncated,
  };
}
