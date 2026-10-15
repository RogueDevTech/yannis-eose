import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';

/** Unique visitors in the window before a form with no orders is worth flagging. */
export const FORM_NO_ORDERS_MIN_VISITORS = 100;
const WINDOW_HOURS = 24;
/** Loads of one form on another buyer's website (24h) before it is flagged. */
export const FORM_ON_OTHER_PAGE_MIN_VIEWS = 3;

/**
 * Cron: a form that keeps getting visitors but takes no orders.
 *
 * Oct 2026: "Adam Brahmi-Shakti - KENYA" had ~700 real Kenyan visitors over
 * three days and zero orders. Nobody even pressed Submit (no failed-submit
 * records), so the landing page around the form was the problem. Nothing told
 * the Media Buyer, who kept paying for the traffic.
 *
 * Hourly: any ACTIVE form with at least FORM_NO_ORDERS_MIN_VISITORS unique
 * visitors in the last 24 hours and no order at all (any status, so a submit
 * that was later cleaned up still counts as a submit) notifies the form's
 * Media Buyer and the Heads of Marketing on the form's branch. One alert per
 * form per day per person (dedupeKey). Read-only: never touches the intake path.
 */
@Injectable()
export class FormNoOrdersAlertService {
  private readonly logger = new Logger('FormNoOrdersAlert');

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationsService,
  ) {}

  // Hourly at :15 (Nest cron: sec min hour dom mon dow).
  @Cron('0 15 * * * *')
  async handleHourly(): Promise<void> {
    try {
      await this.checkForms();
    } catch (err) {
      this.logger.error(`Form no-orders check failed: ${(err as Error)?.message ?? err}`);
    }
  }

  async checkForms(): Promise<number> {
    const rows = await this.db.execute<{
      campaign_id: string;
      name: string;
      media_buyer_id: string | null;
      branch_id: string | null;
      visitors: number;
      carts: number;
      failed: number;
    }>(sql`
      WITH v AS (
        SELECT campaign_id, count(DISTINCT session_id)::int AS visitors
        FROM campaign_views
        WHERE viewed_at >= now() - make_interval(hours => ${WINDOW_HOURS})
        GROUP BY campaign_id
        HAVING count(DISTINCT session_id) >= ${FORM_NO_ORDERS_MIN_VISITORS}
      )
      SELECT c.id AS campaign_id, c.name, c.media_buyer_id, c.branch_id, v.visitors,
             (SELECT count(*)::int FROM cart_abandonments ca
               WHERE ca.campaign_id = c.id AND ca.created_at >= now() - make_interval(hours => ${WINDOW_HOURS})) AS carts,
             (SELECT count(*)::int FROM form_submit_attempts f
               WHERE f.campaign_id = c.id AND f.attempted_at >= now() - make_interval(hours => ${WINDOW_HOURS})) AS failed
      FROM v
      JOIN campaigns c ON c.id = v.campaign_id AND c.status = 'ACTIVE'
      WHERE NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.campaign_id = c.id AND o.created_at >= now() - make_interval(hours => ${WINDOW_HOURS})
      )
    `);

    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    for (const r of rows) {
      const link = `/admin/marketing/analytics/${r.campaign_id}`;
      const extra =
        Number(r.failed) > 0
          ? `${Number(r.failed)} submits failed, so customers are being stopped.`
          : Number(r.carts) > 0
            ? `${Number(r.carts)} started the form but nobody submitted.`
            : 'Nobody pressed Submit. Check the landing page on a phone.';
      const input = {
        type: 'marketing:form_no_orders',
        title: 'Form has visitors but no orders',
        body: `"${r.name}": ${Number(r.visitors)} visitors in the last 24 hours and no orders. ${extra}`,
        data: { campaignId: r.campaign_id, link, ...(r.branch_id ? { branchId: r.branch_id } : {}) },
        dedupeKey: `form_no_orders:${r.campaign_id}:${day}`,
      };
      if (r.media_buyer_id) this.notifications.enqueueCreate({ ...input, userId: r.media_buyer_id });
      // Branch-scoped via data.branchId: only Heads of Marketing on this form's branch.
      if (r.branch_id) this.notifications.enqueueCreateForRole('HEAD_OF_MARKETING', input);
    }
    if (rows.length > 0) {
      this.logger.log(`Form no-orders: ${rows.length} form(s) flagged: ${[...rows].map((r) => r.name).slice(0, 10).join('; ')}`);
    }
    return rows.length;
  }

  // Hourly at :20.
  @Cron('0 20 * * * *')
  async handleForeignHostHourly(): Promise<void> {
    try {
      await this.checkFormsOnOtherPages();
    } catch (err) {
      this.logger.error(`Form on-other-page check failed: ${(err as Error)?.message ?? err}`);
    }
  }

  /**
   * A form loading on a website that belongs to a different Media Buyer: its
   * orders are credited to the form's owner, not to the owner of the page
   * (Oct 15: Shola's form on Ajayi's landing page). Needs campaign_views.host_domain
   * (0356), so only iframe / embedded views from forms rendered after that count.
   *
   * Who owns a website: the Media Buyer whose forms send customers to a thank-you
   * page on it (exactly one buyer). If no thank-you page is on it, the buyer
   * whose forms load there most in 14 days. A site shared by several buyers'
   * thank-you pages is skipped, never guessed.
   */
  async checkFormsOnOtherPages(): Promise<number> {
    const rows = await this.db.execute<{
      campaign_id: string;
      name: string;
      media_buyer_id: string;
      mb_name: string | null;
      branch_id: string | null;
      host_domain: string;
      views: number;
      owner_id: string;
      owner_name: string | null;
    }>(sql`
      WITH recent AS (
        SELECT campaign_id, host_domain, count(*)::int AS views
        FROM campaign_views
        WHERE viewed_at >= now() - make_interval(hours => ${WINDOW_HOURS})
          AND host_domain IS NOT NULL AND deployment_type IN ('iframe', 'embedded')
        GROUP BY 1, 2
        HAVING count(*) >= ${FORM_ON_OTHER_PAGE_MIN_VIEWS}
      ),
      thank_you AS (
        SELECT lower(regexp_replace(c.form_config->>'successCallbackUrl', '^https?://(www\\.)?([^/:?#]+).*$', '\\2')) AS host,
               c.media_buyer_id
        FROM campaigns c
        WHERE c.form_config->>'successCallbackUrl' ~* '^https?://'
      ),
      ty_owner AS (
        SELECT host, min(media_buyer_id::text)::uuid AS owner_id
        FROM thank_you
        WHERE host IN (SELECT host_domain FROM recent)
        GROUP BY host
        HAVING count(DISTINCT media_buyer_id) = 1
      ),
      ty_shared AS (
        SELECT host FROM thank_you WHERE host IN (SELECT host_domain FROM recent)
        GROUP BY host HAVING count(DISTINCT media_buyer_id) > 1
      ),
      view_owner AS (
        SELECT DISTINCT ON (host_domain) host_domain AS host, media_buyer_id AS owner_id
        FROM campaign_views
        WHERE viewed_at >= now() - interval '14 days' AND media_buyer_id IS NOT NULL
          AND host_domain IN (SELECT host_domain FROM recent) AND deployment_type IN ('iframe', 'embedded')
        GROUP BY host_domain, media_buyer_id
        ORDER BY host_domain, count(*) DESC
      )
      SELECT r.campaign_id, c.name, c.media_buyer_id, mb.name AS mb_name, c.branch_id, r.host_domain, r.views,
             coalesce(t.owner_id, vo.owner_id) AS owner_id, ou.name AS owner_name
      FROM recent r
      JOIN campaigns c ON c.id = r.campaign_id AND c.status = 'ACTIVE'
      LEFT JOIN ty_owner t ON t.host = r.host_domain
      LEFT JOIN view_owner vo ON vo.host = r.host_domain
      LEFT JOIN users mb ON mb.id = c.media_buyer_id
      LEFT JOIN users ou ON ou.id = coalesce(t.owner_id, vo.owner_id)
      WHERE r.host_domain NOT IN (SELECT host FROM ty_shared)
        AND coalesce(t.owner_id, vo.owner_id) IS NOT NULL
        AND coalesce(t.owner_id, vo.owner_id) <> c.media_buyer_id
    `);

    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    for (const r of rows) {
      const link = `/admin/marketing/analytics/${r.campaign_id}`;
      const owner = r.owner_name ?? 'another Media Buyer';
      const formOwner = r.mb_name ?? 'another Media Buyer';
      const base = {
        type: 'marketing:form_on_other_page',
        title: "Form on another buyer's page",
        data: { campaignId: r.campaign_id, hostDomain: r.host_domain, link, ...(r.branch_id ? { branchId: r.branch_id } : {}) },
        dedupeKey: `form_on_other_page:${r.campaign_id}:${r.host_domain}:${day}`,
      };
      // The form's owner: orders from that page are coming to them.
      this.notifications.enqueueCreate({
        ...base,
        userId: r.media_buyer_id,
        body: `Your form "${r.name}" loaded ${Number(r.views)} times in the last 24 hours on ${r.host_domain}, which is ${owner}'s website. Orders placed there are credited to you.`,
      });
      // The page's owner: their page is sending orders to someone else.
      this.notifications.enqueueCreate({
        ...base,
        userId: r.owner_id,
        body: `${formOwner}'s form "${r.name}" is on your website ${r.host_domain} (${Number(r.views)} loads in 24 hours). Orders placed there go to ${formOwner}. Replace it with your own form code.`,
      });
      if (r.branch_id) {
        this.notifications.enqueueCreateForRole('HEAD_OF_MARKETING', {
          ...base,
          body: `${formOwner}'s form "${r.name}" is loading on ${r.host_domain}, ${owner}'s website (${Number(r.views)} loads in 24 hours). Its orders go to ${formOwner}.`,
        });
      }
    }
    if (rows.length > 0) {
      this.logger.log(`Form on other page: ${rows.length} flagged: ${[...rows].map((r) => `${r.name} @ ${r.host_domain}`).slice(0, 10).join('; ')}`);
    }
    return rows.length;
  }
}
