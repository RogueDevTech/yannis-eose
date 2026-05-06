import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, desc, count, inArray, or, gte, lte, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import sgMail from '@sendgrid/mail';
import { db as schema } from '@yannis/shared';
import type {
  ListNotificationsInput,
  MarkNotificationsReadInput,
  CreateNotificationInput,
  SavePushSubscriptionInput,
  RemovePushSubscriptionInput,
  BroadcastPushInput,
  GetPushDeliveryLogInput,
  UpdateAutomationRuleInput,
  CreateAutomationRuleInput,
} from '@yannis/shared';
import {
  MANDATORY_EMAIL_TYPES,
  CONFIGURABLE_EMAIL_TYPES,
  NOTIFICATION_EMAIL_CONFIG_KEY,
} from '@yannis/shared';
import type { NotificationPreferences } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { SettingsService } from '../settings/settings.service';
import { CacheService } from '../common/cache/cache.service';
import type webPushType from 'web-push';

// Lazy-loaded web-push — avoids CJS interop issues at startup
let webpush: typeof webPushType | null = null;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly sendgridConfigured: boolean;
  /** Lazily resolves when web-push is loaded and VAPID is applied (or false if disabled / failed). */
  private webPushReady: Promise<boolean> | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventsService,
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
  ) {
    const apiKey = process.env['SENDGRID_API_KEY'];
    if (apiKey) {
      sgMail.setApiKey(apiKey);
      this.sendgridConfigured = true;
      this.logger.log('SendGrid configured');
    } else {
      this.sendgridConfigured = false;
      this.logger.warn('SENDGRID_API_KEY not set — email sending disabled');
    }

    const vapidPublic = process.env['VAPID_PUBLIC_KEY'];
    const vapidPrivate = process.env['VAPID_PRIVATE_KEY'];
    if (!vapidPublic || !vapidPrivate) {
      this.logger.warn('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — web push disabled');
    }
  }

  /**
   * Ensures web-push is loaded and VAPID configured. Safe to call from every sendPush — deduped.
   */
  private getWebPushReady(): Promise<boolean> {
    if (this.webPushReady) {
      return this.webPushReady;
    }

    const vapidPublic = process.env['VAPID_PUBLIC_KEY'];
    const vapidPrivate = process.env['VAPID_PRIVATE_KEY'];
    const vapidSubject = process.env['VAPID_SUBJECT'] ?? 'mailto:admin@yannis.com';

    if (!vapidPublic || !vapidPrivate) {
      this.webPushReady = Promise.resolve(false);
      return this.webPushReady;
    }

    this.webPushReady = import('web-push')
      .then((mod) => {
        webpush = (mod.default ?? mod) as typeof webPushType;
        webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
        this.logger.log('web-push VAPID configured');
        return true;
      })
      .catch((err) => {
        this.logger.warn(`web-push failed to load — push notifications disabled: ${err}`);
        return false;
      });

    return this.webPushReady;
  }

  // ============================================================
  // EMAIL METHODS (UNCHANGED)
  // ============================================================

  /**
   * Send an email via SendGrid.
   * Non-blocking — logs errors but doesn't throw (email is best-effort).
   */
  async sendEmail(opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<boolean> {
    if (!this.sendgridConfigured) {
      this.logger.warn(`Email not sent (SendGrid not configured): ${opts.subject} → ${opts.to}`);
      return false;
    }

    try {
      await sgMail.send({
        to: opts.to,
        from: {
          email: process.env['SENDGRID_FROM_EMAIL'] ?? 'noreply@yannis.com',
          name: process.env['SENDGRID_FROM_NAME'] ?? 'Yannis EOSE',
        },
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      this.logger.log(`Email sent: ${opts.subject} → ${opts.to}`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const hint =
        msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')
          ? ' (DNS could not resolve api.sendgrid.com — check network/VPN/DNS; axios respects HTTPS_PROXY if set)'
          : '';
      this.logger.error(`Failed to send email to ${opts.to}: ${error}${hint}`);
      return false;
    }
  }

  /**
   * Send a staff invite email with login credentials.
   */
  async sendInviteEmail(opts: {
    to: string;
    name: string;
    role: string;
    password: string;
    loginUrl: string;
  }): Promise<boolean> {
    const roleName = opts.role
      .split('_')
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(' ');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 0;">
        <div style="background: #1565C0; padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <h1 style="color: #fff; margin: 0; font-size: 22px;">Welcome to Yannis EOSE</h1>
        </div>
        <div style="background: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            Hi <strong>${opts.name}</strong>,
          </p>
          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
            You've been added to Yannis EOSE as <strong>${roleName}</strong>. Use the credentials below to sign in:
          </p>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 0 0 24px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="color: #6b7280; font-size: 13px; padding: 4px 0;">Email</td>
                <td style="color: #111827; font-size: 14px; font-weight: 600; padding: 4px 0; text-align: right;">${opts.to}</td>
              </tr>
              <tr>
                <td style="color: #6b7280; font-size: 13px; padding: 4px 0;">Password</td>
                <td style="color: #111827; font-size: 14px; font-weight: 600; padding: 4px 0; text-align: right; font-family: monospace;">${opts.password}</td>
              </tr>
            </table>
          </div>
          <a href="${opts.loginUrl}" style="display: block; text-align: center; background: #1565C0; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
            Sign In Now
          </a>
          <p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 24px 0 0; text-align: center;">
            Please change your password after your first login.
          </p>
        </div>
      </div>
    `;

    const text = `Welcome to Yannis EOSE!\n\nHi ${opts.name},\n\nYou've been added as ${roleName}.\n\nEmail: ${opts.to}\nPassword: ${opts.password}\n\nSign in at: ${opts.loginUrl}\n\nPlease change your password after your first login.`;

    return this.sendEmail({
      to: opts.to,
      subject: `You're invited to Yannis EOSE — Your login credentials`,
      html,
      text,
    });
  }

  /**
   * Create notifications for all ACTIVE users with a given role.
   * Fan-out runs in parallel per user. Prefer `enqueueCreateForRole` on request paths so HTTP latency
   * is not tied to DB insert + push for every recipient.
   */
  async createForRole(
    role: (typeof schema.users.$inferSelect)['role'],
    input: Omit<CreateNotificationInput, 'userId'>,
  ): Promise<void> {
    const rows = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.role, role),
          eq(schema.users.status, 'ACTIVE'),
        ),
      );

    await Promise.all(
      rows.map(async (row) => {
        try {
          await this.create({ ...input, userId: row.id });
        } catch (err) {
          this.logger.warn(`Failed to create notification for user ${row.id}: ${err}`);
        }
      }),
    );
  }

  /**
   * Create notifications for ACTIVE users at a specific logistics location
   * (TPL_MANAGER, TPL_RIDER with that logisticsLocationId).
   */
  async createForLocation(
    locationId: string,
    input: Omit<CreateNotificationInput, 'userId'>,
  ): Promise<void> {
    const rows = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.logisticsLocationId, locationId),
          eq(schema.users.status, 'ACTIVE'),
        ),
      );

    await Promise.all(
      rows.map(async (row) => {
        try {
          await this.create({ ...input, userId: row.id });
        } catch (err) {
          this.logger.warn(`Failed to create notification for user ${row.id}: ${err}`);
        }
      }),
    );
  }

  /**
   * Single-recipient in-app (+ push) notification without blocking the caller.
   */
  enqueueCreate(input: CreateNotificationInput): void {
    void this.create(input).catch((err: unknown) => {
      this.logger.warn(
        `enqueueCreate failed user=${input.userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /**
   * Fire-and-forget role fan-out (`createForRole`). Use from orders / inventory / cart / payment code paths
   * so request latency is not tied to N sequential `create()` calls. Errors are logged only.
   */
  enqueueCreateForRole(
    role: (typeof schema.users.$inferSelect)['role'],
    input: Omit<CreateNotificationInput, 'userId'>,
  ): void {
    void this.createForRole(role, input).catch((err: unknown) => {
      this.logger.warn(
        `createForRole(${role}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /**
   * Fire-and-forget location fan-out (`createForLocation`). Same rationale as `enqueueCreateForRole`.
   */
  enqueueCreateForLocation(locationId: string, input: Omit<CreateNotificationInput, 'userId'>): void {
    void this.createForLocation(locationId, input).catch((err: unknown) => {
      this.logger.warn(
        `createForLocation(${locationId}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /**
   * Check if email should be sent for this notification type.
   * Mandatory types always return true; configurable types check settings.
   */
  private async shouldSendEmailForType(type: string): Promise<boolean> {
    if ((MANDATORY_EMAIL_TYPES as readonly string[]).includes(type)) {
      return true;
    }
    if (!(CONFIGURABLE_EMAIL_TYPES as readonly string[]).includes(type)) {
      return false;
    }
    const config = await this.settings.get(NOTIFICATION_EMAIL_CONFIG_KEY);
    const enabledTypes = config?.['enabledTypes'] as Record<string, boolean> | undefined;
    return enabledTypes?.[type] === true;
  }

  /**
   * Send notification email to user. Non-blocking — best-effort.
   */
  private async sendNotificationEmail(
    userId: string,
    type: string,
    title: string,
    body: string | null,
    data: Record<string, unknown> | null,
  ): Promise<void> {
    const userRows = await this.db
      .select({ email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const user = userRows[0];
    if (!user?.email) return;

    const appUrl = process.env['APP_URL'] ?? 'http://localhost:4001';
    const linkPath = this.getLinkPathForType(type, data);
    const link = linkPath ? `${appUrl}${linkPath}` : appUrl;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 0;">
        <div style="background: #1565C0; padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <h1 style="color: #fff; margin: 0; font-size: 22px;">Yannis EOSE</h1>
        </div>
        <div style="background: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            Hi${user.name ? ` ${user.name}` : ''},
          </p>
          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            <strong>${title}</strong>
          </p>
          ${body ? `<p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">${body}</p>` : ''}
          <a href="${link}" style="display: inline-block; background: #1565C0; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
            View in Dashboard
          </a>
        </div>
      </div>
    `;

    const text = `${title}\n\n${body ?? ''}\n\nView: ${link}`;

    await this.sendEmail({
      to: user.email,
      subject: `Yannis EOSE — ${title}`,
      html,
      text,
    });
  }

  /** Map notification type + data to deep link path */
  private getLinkPathForType(type: string, data: Record<string, unknown> | null): string | null {
    // Account alerts: open notification center (role-agnostic hub)
    if (type === 'account:updated' || type === 'account:security') {
      return '/admin/notifications';
    }
    if (!data) return '/admin';
    if (data['permissionRequestKind'] === 'order_line_price') return '/admin/permission-requests';
    if (data['permissionRequestKind'] === 'order_deletion') return '/admin/permission-requests';
    if (data['orderId']) return `/admin/orders/${data['orderId']}`;
    if (data['requestId'] && type.includes('approval')) return '/admin/users';
    if (data['fundingId'] || (data['requesterId'] && type === 'funding:request')) return '/admin/marketing/funding';
    if (data['requestId'] && (type === 'funding:approved' || type === 'funding:rejected')) return '/admin/marketing/funding';
    if (data['transferId']) return '/admin/inventory';
    if (data['payoutId']) return '/admin/hr';
    if (data['batchId'] && type.startsWith('hr:batch_')) return `/hr/payroll?batchId=${data['batchId']}`;
    if (type === 'hr:onboarding_changes_requested' || type === 'hr:onboarding_approved') {
      return '/admin/onboarding';
    }
    if (type === 'hr:onboarding_submitted' && data['userId']) {
      return `/hr/users/${data['userId']}/onboarding`;
    }
    return '/admin';
  }

  /**
   * Check if the recipient has opted out of this notification type.
   * Mandatory (action-required) types ignore the user preference. Missing key /
   * empty map = enabled. Returns true when delivery should be skipped entirely.
   */
  private async isUserOptedOut(userId: string, type: string): Promise<boolean> {
    if ((MANDATORY_EMAIL_TYPES as readonly string[]).includes(type)) {
      return false;
    }
    const [row] = await this.db
      .select({ prefs: schema.users.notificationPreferences })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const prefs = (row?.prefs as NotificationPreferences | null) ?? null;
    return prefs?.[type] === false;
  }

  /**
   * Create a notification and push it via Socket.io in real-time.
   * Sends email if configured for this notification type.
   * Also fires a web push notification (non-blocking, fire-and-forget).
   *
   * Per-user opt-out: if the recipient has set
   * `users.notification_preferences[type] = false`, the entire fan-out is skipped
   * (no DB row, no socket emit, no push, no email). Mandatory types ignore this.
   */
  async create(input: CreateNotificationInput) {
    if (await this.isUserOptedOut(input.userId, input.type)) {
      // Silent drops here are how "I should have 40 notifications, I see 2" happens
      // in practice: a user toggled a type off in Settings → Notifications, then every
      // future notification of that type is skipped (no DB row, no socket, no push, no
      // email). Mandatory types bypass opt-out, so this only fires for opted-out types.
      // Log it (warn-level) so operators have a paper trail without grepping the prefs.
      this.logger.warn(
        `notification:dropped (user opted out) — userId=${input.userId} type=${input.type} title="${input.title}"`,
      );
      return null;
    }

    const rows = await this.db
      .insert(schema.notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        data: input.data ?? null,
      })
      .returning();

    const notification = rows[0];
    if (notification) {
      // Push real-time notification to the user (serialize so client gets plain JSON, e.g. createdAt as string)
      const payload = {
        id: notification.id,
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        read: notification.read,
        createdAt:
          notification.createdAt instanceof Date
            ? notification.createdAt.toISOString()
            : String(notification.createdAt ?? ''),
      };
      this.events.emitToUser(input.userId, 'notification:new', payload);
      if (process.env['LOG_NOTIFICATIONS'] === '1') {
        this.logger.log(
          `notification:new emitted for user=${input.userId} orderId=${(notification.data as Record<string, unknown>)?.orderId ?? 'n/a'}`,
        );
      }

      // Send email if configured (mandatory types always; configurable per settings)
      this.shouldSendEmailForType(input.type)
        .then((send) => {
          if (send) {
            return this.sendNotificationEmail(
              input.userId,
              input.type,
              input.title,
              input.body ?? null,
              (input.data as Record<string, unknown>) ?? null,
            );
          }
        })
        .catch((err) => this.logger.warn(`Notification email check/send failed: ${err}`));

      // Fire web push (non-blocking — mirror trigger)
      const appUrl = process.env['APP_URL'] ?? 'http://localhost:4001';
      const linkPath = this.getLinkPathForType(
        input.type,
        (input.data as Record<string, unknown>) ?? null,
      );
      this.sendPush(
        input.userId,
        {
          title: input.title,
          body: input.body ?? '',
          url: linkPath ? `${appUrl}${linkPath}` : appUrl,
        },
        { triggerType: 'MIRROR' },
      ).catch((err) => this.logger.warn(`Mirror web push failed for user ${input.userId}: ${err}`));
    }

    // Invalidate this user's notification list cache so next request is fresh
    this.cache.delPattern(`cache:notif:${input.userId}:*`).catch(() => undefined);

    return notification;
  }

  /**
   * List notifications for a user with optional unread filter.
   */
  /** Cache key for a user's notification list page. */
  private notifListCacheKey(userId: string, input: ListNotificationsInput): string {
    return `cache:notif:${userId}:p${input.page}:l${input.limit}:u${input.unreadOnly ? '1' : '0'}`;
  }

  async list(userId: string, input: ListNotificationsInput) {
    const cacheKey = this.notifListCacheKey(userId, input);
    const TTL = 15; // seconds

    return this.cache.getOrSet(cacheKey, TTL, async () => {
      const conditions = [eq(schema.notifications.userId, userId)];

      if (input.unreadOnly) {
        conditions.push(eq(schema.notifications.read, false));
      }

      const whereClause = and(...conditions);
      const offset = (input.page - 1) * input.limit;

      const [notifications, totalRows, unreadRows] = await Promise.all([
        this.db
          .select()
          .from(schema.notifications)
          .where(whereClause)
          .orderBy(desc(schema.notifications.createdAt))
          .limit(input.limit)
          .offset(offset),
        this.db
          .select({ count: count() })
          .from(schema.notifications)
          .where(whereClause),
        this.db
          .select({ count: count() })
          .from(schema.notifications)
          .where(
            and(
              eq(schema.notifications.userId, userId),
              eq(schema.notifications.read, false),
            ),
          ),
      ]);

      const total = totalRows[0]?.count ?? 0;
      const unreadCount = unreadRows[0]?.count ?? 0;

      return {
        notifications,
        unreadCount,
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          totalPages: Math.ceil(total / input.limit),
        },
      };
    });
  }

  /**
   * Get unread count for a user.
   */
  async getUnreadCount(userId: string) {
    const rows = await this.db
      .select({ count: count() })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.read, false),
        ),
      );

    return rows[0]?.count ?? 0;
  }

  /**
   * Mark notifications as read.
   */
  async markAsRead(userId: string, input: MarkNotificationsReadInput) {
    await this.db
      .update(schema.notifications)
      .set({ read: true })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          inArray(schema.notifications.id, input.notificationIds),
        ),
      );

    this.cache.delPattern(`cache:notif:${userId}:*`).catch(() => undefined);
    return { success: true };
  }

  /**
   * Mark ALL notifications as read for a user.
   */
  async markAllAsRead(userId: string) {
    await this.db
      .update(schema.notifications)
      .set({ read: true })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.read, false),
        ),
      );

    this.cache.delPattern(`cache:notif:${userId}:*`).catch(() => undefined);
    return { success: true };
  }

  /**
   * Daily retention sweep — deletes:
   *   - Read notifications older than 30 days (the user already saw them)
   *   - Unread notifications older than 90 days (hard cap; ancient unread is
   *     unlikely to be acted on and the bell shouldn't surface stale items)
   *
   * Push delivery rows are NOT touched — they live on `push_delivery_log` for
   * its own retention. Audit / temporal data is unaffected.
   *
   * Runs at 03:15 server-local time. The 15-minute offset stays clear of the
   * top-of-hour cron rush (mat-view refresh + push automations).
   */
  @Cron('0 15 3 * * *')
  async cleanupOldNotifications(): Promise<void> {
    try {
      const now = Date.now();
      const READ_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
      const UNREAD_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
      const readCutoff = new Date(now - READ_RETENTION_MS);
      const unreadCutoff = new Date(now - UNREAD_RETENTION_MS);

      const readDeleted = await this.db
        .delete(schema.notifications)
        .where(
          and(
            eq(schema.notifications.read, true),
            lt(schema.notifications.createdAt, readCutoff),
          ),
        )
        .returning({ id: schema.notifications.id });

      const unreadDeleted = await this.db
        .delete(schema.notifications)
        .where(lt(schema.notifications.createdAt, unreadCutoff))
        .returning({ id: schema.notifications.id });

      this.logger.log(
        `Notification cleanup: removed ${readDeleted.length} read (>30d) + ${unreadDeleted.length} stale (>90d) notifications`,
      );

      // The unread-count cache is keyed per-user; invalidate broadly so any
      // affected users see fresh counts on next bell open. delPattern covers
      // every key matching `cache:notif:*`.
      await this.cache.delPattern('cache:notif:*').catch(() => undefined);
    } catch (err) {
      this.logger.error('Notification cleanup failed', err);
    }
  }

  // ============================================================
  // PUSH NOTIFICATION METHODS
  // ============================================================

  /**
   * Send a web push notification to all active subscriptions for a user.
   * Inserts a delivery log row per device before send so the payload can include `logId` for SW ack.
   * @returns Count of subscriptions that received a successful push (not "users").
   */
  async sendPush(
    userId: string,
    payload: { title: string; body: string; url?: string; tag?: string },
    meta: {
      triggerType: 'MIRROR' | 'BROADCAST' | 'AUTOMATION';
      broadcastId?: string;
      automationRuleId?: string;
    },
  ): Promise<number> {
    const vapidOk = await this.getWebPushReady();
    const wp = webpush;
    if (!vapidOk || !wp) {
      return 0;
    }

    const subscriptions = await this.db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, userId));

    if (subscriptions.length === 0) {
      return 0;
    }

    const urlForClient = payload.url ?? '/admin';

    const results = await Promise.all(
      subscriptions.map(async (sub) => {
        let logId: string;

        try {
          const inserted = await this.db
            .insert(schema.pushDeliveryLog)
            .values({
              userId,
              broadcastId: meta.broadcastId ?? null,
              automationRuleId: meta.automationRuleId ?? null,
              title: payload.title,
              body: payload.body,
              triggerType: meta.triggerType,
              status: 'SENT',
              failureReason: null,
            })
            .returning({ id: schema.pushDeliveryLog.id });

          const id = inserted[0]?.id;
          if (!id) {
            return 0;
          }
          logId = id;
        } catch (logErr) {
          this.logger.warn(`Failed to write push delivery log: ${logErr}`);
          return 0;
        }

        const pushPayloadStr = JSON.stringify({
          title: payload.title,
          body: payload.body,
          data: { url: urlForClient, logId },
          tag: payload.tag,
        });

        try {
          await wp.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { auth: sub.auth, p256dh: sub.p256dh },
            },
            pushPayloadStr,
          );
          return 1;
        } catch (err: unknown) {
          const statusCode =
            err && typeof err === 'object' && 'statusCode' in err
              ? (err as { statusCode: number }).statusCode
              : null;

          const failureReason = err instanceof Error ? err.message : String(err);

          await this.db
            .update(schema.pushDeliveryLog)
            .set({ status: 'FAILED', failureReason })
            .where(eq(schema.pushDeliveryLog.id, logId))
            .catch((e) => this.logger.warn(`Failed to mark push log failed: ${e}`));

          if (statusCode === 410 || statusCode === 404) {
            await this.db
              .delete(schema.pushSubscriptions)
              .where(eq(schema.pushSubscriptions.endpoint, sub.endpoint))
              .catch((deleteErr) =>
                this.logger.warn(`Failed to delete stale push subscription: ${deleteErr}`),
              );
          }

          return 0;
        }
      }),
    );

    let delivered = 0;
    for (const n of results) {
      delivered += n;
    }
    return delivered;
  }

  /**
   * Save (upsert) a push subscription for a user.
   * If the endpoint already exists, updates auth/p256dh/userAgent.
   */
  async savePushSubscription(
    userId: string,
    input: SavePushSubscriptionInput,
  ): Promise<void> {
    const installMode = input.installMode ?? 'UNKNOWN';
    const installModeUpdatedAt = input.installMode ? new Date() : null;
    await this.db
      .insert(schema.pushSubscriptions)
      .values({
        userId,
        endpoint: input.endpoint,
        auth: input.auth,
        p256dh: input.p256dh,
        userAgent: input.userAgent ?? null,
        installMode,
        installModeUpdatedAt,
      })
      .onConflictDoUpdate({
        target: schema.pushSubscriptions.endpoint,
        set: {
          userId,
          auth: input.auth,
          p256dh: input.p256dh,
          userAgent: input.userAgent ?? null,
          installMode,
          installModeUpdatedAt,
        },
      });
  }

  /**
   * Remove this device's push subscription for the user. Idempotent if no row matches.
   */
  async removePushSubscription(
    userId: string,
    input: RemovePushSubscriptionInput,
  ): Promise<void> {
    await this.db
      .delete(schema.pushSubscriptions)
      .where(
        and(
          eq(schema.pushSubscriptions.userId, userId),
          eq(schema.pushSubscriptions.endpoint, input.endpoint),
        ),
      );
  }

  /**
   * Heartbeat: update the install_mode on an existing subscription by endpoint.
   * Called from the client on every app mount so the dashboard reflects the latest state
   * (e.g. user installed the PWA yesterday, removed it today). Idempotent; silently no-ops
   * if no row matches — that's fine, they'll subscribe fresh via savePushSubscription.
   */
  async updatePushInstallMode(
    userId: string,
    input: { endpoint: string; installMode: 'STANDALONE' | 'BROWSER' | 'UNKNOWN' },
  ): Promise<void> {
    await this.db
      .update(schema.pushSubscriptions)
      .set({
        installMode: input.installMode,
        installModeUpdatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.pushSubscriptions.userId, userId),
          eq(schema.pushSubscriptions.endpoint, input.endpoint),
        ),
      );
  }

  /**
   * Broadcast a push notification to a target audience.
   * Returns the number of users who were sent the notification.
   */
  async broadcastPush(
    actorId: string,
    branchId: string | null,
    input: BroadcastPushInput,
  ): Promise<{ recipientCount: number; pushDeliveryCount: number }> {
    // Resolve target users
    let targetUserIds: string[] = [];

    if (input.targetType === 'USER' && input.targetUserId) {
      targetUserIds = [input.targetUserId];
    } else if (input.targetType === 'ROLE' && input.targetRole) {
      const roleRows = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.role, input.targetRole as (typeof schema.users.$inferSelect)['role']),
            eq(schema.users.status, 'ACTIVE'),
          ),
        );
      targetUserIds = roleRows.map((r) => r.id);
    } else if (input.targetType === 'ALL') {
      const allRows = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.status, 'ACTIVE'));
      targetUserIds = allRows.map((r) => r.id);
    }

    if (targetUserIds.length === 0) {
      return { recipientCount: 0, pushDeliveryCount: 0 };
    }

    // Insert broadcast record
    const broadcastRows = await this.db
      .insert(schema.pushBroadcasts)
      .values({
        createdBy: actorId,
        targetType: input.targetType,
        targetRole: input.targetRole ?? null,
        targetUserId: input.targetUserId ?? null,
        title: input.title,
        body: input.body,
        branchId: branchId ?? null,
      })
      .returning({ id: schema.pushBroadcasts.id });

    const broadcastId = broadcastRows[0]?.id;

    const perUserCounts = await Promise.all(
      targetUserIds.map((uid) =>
        this.sendPush(
          uid,
          { title: input.title, body: input.body },
          { triggerType: 'BROADCAST', broadcastId },
        ).catch((err) => {
          this.logger.warn(`Broadcast push failed for user ${uid}: ${err}`);
          return 0;
        }),
      ),
    );

    const pushDeliveryCount = perUserCounts.reduce((a, b) => a + b, 0);

    return { recipientCount: targetUserIds.length, pushDeliveryCount };
  }

  /**
   * Get paginated push delivery log with optional filters.
   */
  async getDeliveryLog(
    input: GetPushDeliveryLogInput,
    actorRole: string,
    actorId: string,
  ) {
    const conditions: Parameters<typeof and>[0][] = [];

    // Non-admin users can only see their own logs
    if (actorRole !== 'SUPER_ADMIN' && actorRole !== 'ADMIN' && actorRole !== 'BRANCH_ADMIN') {
      conditions.push(eq(schema.pushDeliveryLog.userId, actorId));
    } else if (input.userId) {
      conditions.push(eq(schema.pushDeliveryLog.userId, input.userId));
    }

    if (input.status) {
      conditions.push(eq(schema.pushDeliveryLog.status, input.status));
    }
    if (input.triggerType) {
      conditions.push(eq(schema.pushDeliveryLog.triggerType, input.triggerType));
    }
    if (input.broadcastId) {
      conditions.push(eq(schema.pushDeliveryLog.broadcastId, input.broadcastId));
    }
    if (input.dateFrom) {
      conditions.push(gte(schema.pushDeliveryLog.sentAt, new Date(input.dateFrom)));
    }
    if (input.dateTo) {
      conditions.push(lte(schema.pushDeliveryLog.sentAt, new Date(input.dateTo)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [logs, totalRows] = await Promise.all([
      this.db
        .select({
          id: schema.pushDeliveryLog.id,
          userId: schema.pushDeliveryLog.userId,
          broadcastId: schema.pushDeliveryLog.broadcastId,
          automationRuleId: schema.pushDeliveryLog.automationRuleId,
          title: schema.pushDeliveryLog.title,
          body: schema.pushDeliveryLog.body,
          triggerType: schema.pushDeliveryLog.triggerType,
          status: schema.pushDeliveryLog.status,
          failureReason: schema.pushDeliveryLog.failureReason,
          sentAt: schema.pushDeliveryLog.sentAt,
          shownAt: schema.pushDeliveryLog.shownAt,
          clickedAt: schema.pushDeliveryLog.clickedAt,
          userName: schema.users.name,
        })
        .from(schema.pushDeliveryLog)
        .leftJoin(schema.users, eq(schema.pushDeliveryLog.userId, schema.users.id))
        .where(whereClause)
        .orderBy(desc(schema.pushDeliveryLog.sentAt))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.pushDeliveryLog)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Aggregate counts per status for this filter set (useful for dashboard)
    const aggregateRows = await this.db
      .select({ status: schema.pushDeliveryLog.status, count: count() })
      .from(schema.pushDeliveryLog)
      .where(whereClause)
      .groupBy(schema.pushDeliveryLog.status);

    const aggregates = Object.fromEntries(
      aggregateRows.map((r) => [r.status, r.count]),
    ) as Record<string, number>;

    return {
      logs,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
      aggregates,
    };
  }

  /**
   * Resend a single push delivery — creates a new log row.
   */
  async resendPush(logId: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(schema.pushDeliveryLog)
      .where(eq(schema.pushDeliveryLog.id, logId))
      .limit(1);

    const log = rows[0];
    if (!log) return;

    await this.sendPush(
      log.userId,
      { title: log.title, body: log.body },
      {
        triggerType: log.triggerType,
        broadcastId: log.broadcastId ?? undefined,
        automationRuleId: log.automationRuleId ?? undefined,
      },
    );
  }

  /**
   * Resend multiple push deliveries in bulk.
   */
  async bulkResendPush(logIds: string[]): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    await Promise.all(
      logIds.map(async (logId) => {
        try {
          await this.resendPush(logId);
          sent++;
        } catch {
          failed++;
        }
      }),
    );

    return { sent, failed };
  }

  /**
   * Acknowledge a push notification event (shown or clicked).
   * Updates the delivery log record.
   */
  async ackPush(logId: string, event: 'shown' | 'clicked'): Promise<void> {
    const now = new Date();
    if (event === 'shown') {
      await this.db
        .update(schema.pushDeliveryLog)
        .set({ shownAt: now, status: 'SHOWN' })
        .where(
          and(
            eq(schema.pushDeliveryLog.id, logId),
            // Only update if not already clicked (don't downgrade status)
            or(
              eq(schema.pushDeliveryLog.status, 'SENT'),
              eq(schema.pushDeliveryLog.status, 'SHOWN'),
            ),
          ),
        );
    } else {
      await this.db
        .update(schema.pushDeliveryLog)
        .set({ clickedAt: now, status: 'CLICKED' })
        .where(eq(schema.pushDeliveryLog.id, logId));
    }
  }

  // ============================================================
  // PUSH AUTOMATION RULE METHODS
  // ============================================================

  /**
   * Get all automation rules.
   * When branchId is null (SuperAdmin), returns all rules across all branches.
   */
  async getAutomationRules(branchId: string | null) {
    if (branchId === null) {
      return this.db
        .select()
        .from(schema.pushAutomationRules)
        .orderBy(desc(schema.pushAutomationRules.validFrom));
    }

    // Non-SuperAdmin sees only their branch's rules
    return this.db
      .select()
      .from(schema.pushAutomationRules)
      .where(eq(schema.pushAutomationRules.branchId, branchId))
      .orderBy(desc(schema.pushAutomationRules.validFrom));
  }

  /**
   * Create a new push automation rule.
   */
  async createAutomationRule(
    actorId: string,
    branchId: string | null,
    input: CreateAutomationRuleInput,
  ) {
    const rows = await this.db
      .insert(schema.pushAutomationRules)
      .values({
        name: input.name,
        triggerType: input.triggerType,
        cronExpr: input.cronExpr ?? null,
        eventKey: input.eventKey ?? null,
        targetType: input.targetType,
        targetRole: input.targetRole ?? null,
        targetUserId: input.targetUserId ?? null,
        titleTemplate: input.titleTemplate,
        bodyTemplate: input.bodyTemplate,
        isActive: input.isActive,
        branchId: branchId ?? null,
        createdBy: actorId,
      })
      .returning();

    return rows[0]!;
  }

  /**
   * Update an existing push automation rule.
   */
  async updateAutomationRule(actorId: string, input: UpdateAutomationRuleInput) {
    const { id, ...rest } = input;
    const updateData: Partial<typeof schema.pushAutomationRules.$inferInsert> = {};

    if (rest.name !== undefined) updateData.name = rest.name;
    if (rest.triggerType !== undefined) updateData.triggerType = rest.triggerType;
    if (rest.cronExpr !== undefined) updateData.cronExpr = rest.cronExpr;
    if (rest.eventKey !== undefined) updateData.eventKey = rest.eventKey;
    if (rest.targetType !== undefined) updateData.targetType = rest.targetType;
    if (rest.targetRole !== undefined) updateData.targetRole = rest.targetRole;
    if (rest.targetUserId !== undefined) updateData.targetUserId = rest.targetUserId;
    if (rest.titleTemplate !== undefined) updateData.titleTemplate = rest.titleTemplate;
    if (rest.bodyTemplate !== undefined) updateData.bodyTemplate = rest.bodyTemplate;
    if (rest.isActive !== undefined) updateData.isActive = rest.isActive;
    updateData.modifiedBy = actorId;

    const rows = await this.db
      .update(schema.pushAutomationRules)
      .set(updateData)
      .where(eq(schema.pushAutomationRules.id, id))
      .returning();

    return rows[0]!;
  }

  /**
   * Toggle an automation rule active/inactive.
   */
  async toggleAutomationRule(id: string, isActive: boolean) {
    const rows = await this.db
      .update(schema.pushAutomationRules)
      .set({ isActive })
      .where(eq(schema.pushAutomationRules.id, id))
      .returning();

    return rows[0]!;
  }

  /**
   * Delete an automation rule permanently.
   */
  async deleteAutomationRule(id: string): Promise<void> {
    await this.db
      .delete(schema.pushAutomationRules)
      .where(eq(schema.pushAutomationRules.id, id));
  }

  /**
   * Fire an automation rule — resolve placeholders and send push to target users.
   * Called by the cron scheduler or event dispatcher.
   */
  async fireAutomationRule(ruleId: string): Promise<void> {
    const ruleRows = await this.db
      .select()
      .from(schema.pushAutomationRules)
      .where(
        and(
          eq(schema.pushAutomationRules.id, ruleId),
          eq(schema.pushAutomationRules.isActive, true),
        ),
      )
      .limit(1);

    const rule = ruleRows[0];
    if (!rule) {
      this.logger.warn(`Automation rule ${ruleId} not found or inactive — skipping`);
      return;
    }

    // Resolve target users
    let targetUserIds: string[] = [];

    if (rule.targetType === 'USER' && rule.targetUserId) {
      targetUserIds = [rule.targetUserId];
    } else if (rule.targetType === 'ROLE' && rule.targetRole) {
      const roleRows = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.role, rule.targetRole as (typeof schema.users.$inferSelect)['role']),
            eq(schema.users.status, 'ACTIVE'),
          ),
        );
      targetUserIds = roleRows.map((r) => r.id);
    } else if (rule.targetType === 'ALL') {
      const allRows = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.status, 'ACTIVE'));
      targetUserIds = allRows.map((r) => r.id);
    }

    if (targetUserIds.length === 0) {
      this.logger.log(`Automation rule ${ruleId} fired but no target users found`);
      return;
    }

    // For each user, resolve placeholders and send push
    await Promise.all(
      targetUserIds.map(async (uid) => {
        try {
          // Fetch user context for placeholder resolution
          const userRows = await this.db
            .select({ name: schema.users.name })
            .from(schema.users)
            .where(eq(schema.users.id, uid))
            .limit(1);

          const userName = userRows[0]?.name ?? 'Team Member';

          // Fetch pending order count for this user (CS agents context)
          const orderCountRows = await this.db
            .select({ count: count() })
            .from(schema.orders)
            .where(
              and(
                eq(schema.orders.assignedCsId, uid),
                inArray(schema.orders.status, ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED']),
              ),
            );
          const orderCount = orderCountRows[0]?.count ?? 0;

          const resolvedTitle = rule.titleTemplate
            .replace(/\{\{user_name\}\}/g, userName)
            .replace(/\{\{order_count\}\}/g, String(orderCount));

          const resolvedBody = rule.bodyTemplate
            .replace(/\{\{user_name\}\}/g, userName)
            .replace(/\{\{order_count\}\}/g, String(orderCount));

          await this.sendPush(
            uid,
            { title: resolvedTitle, body: resolvedBody },
            { triggerType: 'AUTOMATION', automationRuleId: ruleId },
          );
        } catch (err) {
          this.logger.warn(`Automation rule ${ruleId} push failed for user ${uid}: ${err}`);
        }
      }),
    );

    // Stamp lastFiredAt
    await this.db
      .update(schema.pushAutomationRules)
      .set({ lastFiredAt: new Date() })
      .where(eq(schema.pushAutomationRules.id, ruleId))
      .catch((err) => this.logger.warn(`Failed to update lastFiredAt for rule ${ruleId}: ${err}`));

    this.logger.log(
      `Automation rule ${ruleId} fired — sent to ${targetUserIds.length} user(s)`,
    );
  }

  /**
   * Get push notification status for a specific user (admin use).
   * Returns device subscription count, device list, and most recent push sent.
   */
  async getPushStatusForUser(userId: string): Promise<{
    subscribedDevices: number;
    devices: Array<{
      id: string;
      userAgent: string | null;
      createdAt: Date;
      installMode: 'STANDALONE' | 'BROWSER' | 'UNKNOWN';
      installModeUpdatedAt: Date | null;
    }>;
    installedDeviceCount: number;
    lastPushSentAt: Date | null;
    totalPushSent: number;
  }> {
    const [devices, lastLog] = await Promise.all([
      this.db
        .select({
          id: schema.pushSubscriptions.id,
          userAgent: schema.pushSubscriptions.userAgent,
          createdAt: schema.pushSubscriptions.createdAt,
          installMode: schema.pushSubscriptions.installMode,
          installModeUpdatedAt: schema.pushSubscriptions.installModeUpdatedAt,
        })
        .from(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.userId, userId))
        .orderBy(desc(schema.pushSubscriptions.createdAt)),
      this.db
        .select({
          sentAt: schema.pushDeliveryLog.sentAt,
          total: count(schema.pushDeliveryLog.id),
        })
        .from(schema.pushDeliveryLog)
        .where(eq(schema.pushDeliveryLog.userId, userId))
        .groupBy(schema.pushDeliveryLog.sentAt)
        .orderBy(desc(schema.pushDeliveryLog.sentAt))
        .limit(1),
    ]);

    const totalRes = await this.db
      .select({ total: count(schema.pushDeliveryLog.id) })
      .from(schema.pushDeliveryLog)
      .where(eq(schema.pushDeliveryLog.userId, userId));

    return {
      subscribedDevices: devices.length,
      devices,
      installedDeviceCount: devices.filter((d) => d.installMode === 'STANDALONE').length,
      lastPushSentAt: lastLog[0]?.sentAt ?? null,
      totalPushSent: Number(totalRes[0]?.total ?? 0),
    };
  }
}
