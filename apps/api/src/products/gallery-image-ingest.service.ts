import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  buildProductGalleryRehostKey,
  db as schema,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import {
  buildObjectStoragePublicUrl,
  getObjectStoragePublicOrigin,
  putBufferToObjectStorage,
  resolveObjectStorageRuntimeConfig,
} from '../common/storage/object-storage';

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
 *      against an `image/*` allowlist, and uploaded to the configured object store under an
 *      environment-prefixed product-gallery key.
 *   4. After all URLs are processed, the product's `gallery_image_urls`
 *      column is updated to the new array. Failed entries keep their
 *      original URL — graceful degradation.
 *
 * Skips when:
 *   - object storage env config is missing (logs once, no throw)
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
        `gallery ingest skipped — object storage env not configured (product=${productId}, urls=${urls.length})`,
      );
      return;
    }

    // Map every URL to either a rehosted URL (download succeeded) or its
    // original (already on our bucket OR download failed — keep the original
    // so the storefront still has something to render).
    const finalUrls: string[] = [];
    let rehostedCount = 0;
    for (let i = 0; i < urls.length; i += 1) {
      const src = urls[i] ?? '';
      if (!this.shouldIngestUrl(src)) {
        finalUrls.push(src);
        continue;
      }
      const rehosted = await this.rehostSingle(productId, src, i);
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
   * Fetch one URL and upload to the configured object store. Returns the new public URL on success,
   * or null on any failure (size cap, MIME mismatch, network error). Caller
   * keeps the original URL on null.
   */
  private async rehostSingle(
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
      const key = buildProductGalleryRehostKey({
        productId,
        extension: ext,
        envPrefix: this.getAssetEnvPrefix(),
        randomSuffix: `img-${index}`,
      });

      await putBufferToObjectStorage({
        key,
        body: buffer,
        contentType,
      });

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
    return Boolean(resolveObjectStorageRuntimeConfig()?.bucket);
  }

  private getAssetEnvPrefix(): string {
    return resolveObjectStorageRuntimeConfig()?.assetEnvPrefix ?? 'dev';
  }

  /** Stable origin under which our uploaded objects are served — used to
   *  detect "already mine" URLs so re-runs are no-ops. */
  private getOwnPublicOrigin(): string {
    return getObjectStoragePublicOrigin();
  }

  private publicUrlFor(key: string): string {
    return buildObjectStoragePublicUrl(key) ?? '';
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
