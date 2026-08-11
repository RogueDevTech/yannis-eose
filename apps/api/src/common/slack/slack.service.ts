import { Injectable, Logger } from '@nestjs/common';
import type { SlackBlock, SlackAttachment } from './slack.types';

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  channel?: string;
  channels?: Array<{ id: string; name: string }>;
  response_metadata?: { next_cursor?: string };
}

const SLACK_API = 'https://slack.com/api';

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);
  private readonly botToken = process.env['SLACK_BOT_TOKEN'] ?? '';
  private readonly enabled = SlackService.resolveEnabled();
  private readonly channelIdCache = new Map<string, string>();

  private static resolveEnabled(): boolean {
    const raw = process.env['SLACK_ALERTS_ENABLED']?.trim().toLowerCase();
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    return process.env['NODE_ENV'] === 'production';
  }

  async sendMessage(
    channel: string,
    text: string,
    blocks?: SlackBlock[],
    attachments?: SlackAttachment[],
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.debug(`slack disabled, skipping message to #${channel}`);
      return;
    }
    if (!this.botToken) {
      this.logger.warn(`SLACK_BOT_TOKEN not set, skipping message to #${channel}`);
      return;
    }
    try {
      await this.postMessage(channel, text, blocks, attachments);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`slack send failed for #${channel}: ${err.message}`, err.stack);
    }
  }

  async sendChunks(channel: string, chunks: SlackBlock[][]): Promise<void> {
    if (chunks.length === 0) return;
    const total = chunks.length;
    for (let i = 0; i < total; i += 1) {
      const suffix = total > 1 ? ` (${i + 1}/${total})` : '';
      await this.sendMessage(channel, `Report${suffix}`, chunks[i]);
    }
  }

  private async postMessage(
    channel: string,
    text: string,
    blocks?: SlackBlock[],
    attachments?: SlackAttachment[],
    isRetry = false,
  ): Promise<void> {
    const body: Record<string, unknown> = { channel, text };
    if (blocks && blocks.length > 0) body['blocks'] = blocks;
    if (attachments && attachments.length > 0) body['attachments'] = attachments;

    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 && !isRetry) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '1');
      await this.delay(retryAfter * 1000);
      return this.postMessage(channel, text, blocks, attachments, true);
    }

    const data = (await res.json()) as SlackApiResponse;
    if (data.ok) return;

    if (!isRetry && (data.error === 'not_in_channel' || data.error === 'channel_not_found')) {
      const channelId = await this.resolveChannelId(channel);
      if (!channelId) {
        this.logger.warn(
          `slack channel #${channel} not found or bot not invited. Invite the bot to the channel (private channels also need the groups:read scope).`,
        );
        return;
      }
      await this.joinChannel(channelId);
      return this.postMessage(channelId, text, blocks, attachments, true);
    }

    this.logger.warn(`slack chat.postMessage returned error=${data.error ?? 'unknown'} for #${channel}`);
  }

  private async resolveChannelId(channelName: string): Promise<string | null> {
    const cached = this.channelIdCache.get(channelName);
    if (cached) return cached;

    for (const types of ['public_channel', 'private_channel']) {
      let cursor: string | undefined;
      do {
        const params = new URLSearchParams({ limit: '200', types, exclude_archived: 'true' });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`${SLACK_API}/conversations.list?${params.toString()}`, {
          headers: { Authorization: `Bearer ${this.botToken}` },
        });
        const data = (await res.json()) as SlackApiResponse;
        if (!data.ok) break;
        const match = (data.channels ?? []).find((c) => c.name === channelName);
        if (match) {
          this.channelIdCache.set(channelName, match.id);
          return match.id;
        }
        cursor = data.response_metadata?.next_cursor || undefined;
      } while (cursor);
    }
    return null;
  }

  private async joinChannel(channelId: string): Promise<void> {
    try {
      await fetch(`${SLACK_API}/conversations.join`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel: channelId }),
      });
    } catch (error) {
      const err = error as Error;
      this.logger.warn(`slack conversations.join failed for ${channelId}: ${err.message}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
