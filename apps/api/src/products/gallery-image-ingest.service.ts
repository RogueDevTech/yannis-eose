import { Injectable, Inject, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';

/**
 * GalleryImageIngestService — rehosts product gallery images on our object
 * store so the storefront / invoice render isn't held hostage by the source
 * site.
 *
 * Lifecycle:
 *   1. `products.create` (or `update`) writes the row with the operator's
 *      original URLs — render works immediately.
 *   2. Caller fires `void galleryImageIngestService.ingestForProduct(id, urls)`
 *      (fire-and-forget). The HTTP response returns; this method finishes in
 *      the background on the Node event loop.
 *   3. Each external URL is fetched (15s timeout, 10 MB cap), MIME-validated
 *      against an `image/*` allowlist, and uploaded to S3/R2 under
 *      `product-images/<productId>/<timestamp>-<idx>.<ext>`.
 *   4. After all URLs are processed, the product's `gallery_image_urls`
 *      column is updated to the new array. Failed entries keep their
 *      original URL — graceful degradation.
 *
 * Skips when:
 *   - S3 env config is missing (logs once, no throw)
 *   - URL already starts with our bucket's public origin (idempotent re-runs)
 *   - URL doesn't look like a valid http(s) URL
 */
@Injectable()
export class GalleryImageIngestService {
  private readonly logger = new Logger(GalleryImageIngestService.name);

  /** Per-image safety caps. Match the existing presigned-URL endpoint. */
  private readonly FETCH_TIMEOUT_MS = 15_000;
  private readonly MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  private readonly ALLOWED_MIME_PREFIX = 'image/';

  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  /**
   * Detect a URL the operator pasted that we should rehost. URLs already
   * served from our bucket (presigned-URL flow) are returned as-is by
   * `shouldIngestUrl()` so the caller can decide whether to skip.
   */
  shouldIngestUrl(url: string): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      const ownOrigin = this.getOwnPublicOrigin();
      if (ownOrigin && url.startsWith(ownOrigin)) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Background entry point. Returns once every URL has been processed —
   * caller should NOT await; instead spawn with `void`. Errors are caught
   * internally so an in-flight request handler that already returned can't
   * surface them anywhere useful.
   */
  async ingestForProduct(productId: string, urls: ReadonlyArray<string>): Promise<void> {
    try {
      await this.ingestInternal(productId, urls);
    } catch (err) {
      this.logger.warn(
        `gallery ingest failed product=${productId} reason=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async ingestInternal(productId: string, urls: ReadonlyArray<string>): Promise<void> {
    if (urls.length === 0) return;
    if (!this.isConfigured()) {
      this.logger.warn(
        `gallery ingest skipped — S3 env not configured (product=${productId}, urls=${urls.length})`,
      );
      return;
    }

    // Map every URL to either a rehosted URL (download succeeded) or its
    // original (already on our bucket OR download failed — keep the original
    // so the storefront still has something to render).
    const client = this.buildClient();
    const finalUrls: string[] = [];
    let rehostedCount = 0;
    for (let i = 0; i < urls.length; i += 1) {
      const src = urls[i] ?? '';
      if (!this.shouldIngestUrl(src)) {
        finalUrls.push(src);
        continue;
      }
      const rehosted = await this.rehostSingle(client, productId, src, i);
      if (rehosted) {
        finalUrls.push(rehosted);
        rehostedCount += 1;
      } else {
        finalUrls.push(src);
      }
    }

    if (rehostedCount === 0) return; // Nothing changed — skip the write.

    // Update the product row. The audit trigger will record this as a
    // separate change attributed to the system user (no actor context set
    // since this is a background job). That's fine — it tells the audit log
    // "image rehost ran", which is the truth.
    await this.db
      .update(schema.products)
      .set({ galleryImageUrls: finalUrls } as Partial<typeof schema.products.$inferInsert>)
      .where(eq(schema.products.id, productId));

    this.logger.log(
      `gallery ingest done product=${productId} rehosted=${rehostedCount}/${urls.length}`,
    );
  }

  /**
   * Fetch one URL and upload to S3. Returns the new public URL on success,
   * or null on any failure (size cap, MIME mismatch, network error). Caller
   * keeps the original URL on null.
   */
  private async rehostSingle(
    client: S3Client,
    productId: string,
    sourceUrl: string,
    index: number,
  ): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(sourceUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        this.logger.warn(`gallery fetch HTTP ${response.status} src=${sourceUrl}`);
        return null;
      }
      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
      if (!contentType.toLowerCase().startsWith(this.ALLOWED_MIME_PREFIX)) {
        this.logger.warn(`gallery skip — not an image (${contentType}) src=${sourceUrl}`);
        return null;
      }
      const contentLength = Number(response.headers.get('content-length') ?? '0');
      if (contentLength > this.MAX_BYTES) {
        this.logger.warn(
          `gallery skip — content-length ${contentLength} > cap src=${sourceUrl}`,
        );
        return null;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > this.MAX_BYTES) {
        this.logger.warn(
          `gallery skip — buffer ${buffer.byteLength} > cap src=${sourceUrl}`,
        );
        return null;
      }

      const ext = this.extensionFor(contentType, sourceUrl);
      const safeProductId = productId.replace(/[^a-zA-Z0-9-]/g, '');
      const key = `product-images/${safeProductId}/${Date.now()}-${index}${ext}`;

      await client.send(
        new PutObjectCommand({
          Bucket: this.getBucket(),
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );

      return this.publicUrlFor(key);
    } catch (err) {
      this.logger.warn(
        `gallery rehost error src=${sourceUrl} reason=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private isConfigured(): boolean {
    return Boolean(
      this.getBucket() && process.env['S3_ACCESS_KEY_ID'] && process.env['S3_SECRET_ACCESS_KEY'],
    );
  }

  private getBucket(): string {
    return process.env['S3_BUCKET'] ?? '';
  }

  private getEndpoint(): string {
    return process.env['S3_ENDPOINT'] ?? '';
  }

  private getRegion(): string {
    return process.env['S3_REGION'] ?? 'us-east-1';
  }

  /** Stable origin under which our uploaded objects are served — used to
   *  detect "already mine" URLs so re-runs are no-ops. */
  private getOwnPublicOrigin(): string {
    const endpoint = this.getEndpoint();
    if (endpoint) return `${endpoint.replace(/\/$/, '')}/${this.getBucket()}/`;
    return `https://${this.getBucket()}.s3.${this.getRegion()}.amazonaws.com/`;
  }

  private publicUrlFor(key: string): string {
    return `${this.getOwnPublicOrigin()}${key}`;
  }

  private buildClient(): S3Client {
    const region = this.getRegion();
    const endpoint = this.getEndpoint();
    const accessKeyId = process.env['S3_ACCESS_KEY_ID'] ?? '';
    const secretAccessKey = process.env['S3_SECRET_ACCESS_KEY'] ?? '';
    return new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  /** Pick a sensible file extension from MIME first, then the URL pathname. */
  private extensionFor(contentType: string, sourceUrl: string): string {
    const fromMime: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/avif': '.avif',
      'image/svg+xml': '.svg',
    };
    const mimeExt = fromMime[contentType.toLowerCase().split(';')[0]?.trim() ?? ''];
    if (mimeExt) return mimeExt;
    try {
      const pathname = new URL(sourceUrl).pathname;
      const match = pathname.match(/\.[a-zA-Z0-9]{2,5}$/);
      if (match) return match[0].toLowerCase();
    } catch {
      // ignored
    }
    return '.bin';
  }
}
