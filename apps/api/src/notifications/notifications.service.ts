import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, desc, count, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import sgMail from '@sendgrid/mail';
import { db as schema } from '@yannis/shared';
import type {
  ListNotificationsInput,
  MarkNotificationsReadInput,
  CreateNotificationInput,
} from '@yannis/shared';
import {
  MANDATORY_EMAIL_TYPES,
  CONFIGURABLE_EMAIL_TYPES,
  NOTIFICATION_EMAIL_CONFIG_KEY,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly sendgridConfigured: boolean;

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventsService,
    private readonly settings: SettingsService,
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
  }

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
      this.logger.error(`Failed to send email to ${opts.to}: ${error}`);
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
        <div style="background: #6366f1; padding: 24px 32px; border-radius: 12px 12px 0 0;">
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
          <a href="${opts.loginUrl}" style="display: block; text-align: center; background: #6366f1; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
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
   * Non-blocking — logs errors but doesn't throw (notifications are best-effort).
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

    for (const row of rows) {
      try {
        await this.create({ ...input, userId: row.id });
      } catch (err) {
        this.logger.warn(`Failed to create notification for user ${row.id}: ${err}`);
      }
    }
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

    for (const row of rows) {
      try {
        await this.create({ ...input, userId: row.id });
      } catch (err) {
        this.logger.warn(`Failed to create notification for user ${row.id}: ${err}`);
      }
    }
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
        <div style="background: #6366f1; padding: 24px 32px; border-radius: 12px 12px 0 0;">
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
          <a href="${link}" style="display: inline-block; background: #6366f1; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
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
    if (!data) return '/admin';
    if (data['orderId']) return `/admin/orders/${data['orderId']}`;
    if (data['requestId'] && type.includes('approval')) return '/admin/users';
    if (data['fundingId'] || (data['requesterId'] && type === 'funding:request')) return '/admin/marketing/funding';
    if (data['requestId'] && (type === 'funding:approved' || type === 'funding:rejected')) return '/admin/marketing/funding';
    if (data['transferId']) return '/admin/inventory';
    if (data['payoutId']) return '/admin/hr';
    return '/admin';
  }

  /**
   * Create a notification and push it via Socket.io in real-time.
   * Sends email if configured for this notification type.
   */
  async create(input: CreateNotificationInput) {
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
    }

    return notification;
  }

  /**
   * List notifications for a user with optional unread filter.
   */
  async list(userId: string, input: ListNotificationsInput) {
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

    return { success: true };
  }
}
