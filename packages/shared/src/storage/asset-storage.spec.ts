import { describe, expect, it } from 'vitest';
import {
  ASSET_FOLDERS,
  buildEnvScopedAssetKey,
  buildProductGalleryRehostKey,
  buildPublicObjectUrl,
} from './asset-storage';

describe('asset storage helpers', () => {
  it('builds env-scoped keys for direct uploads', () => {
    const now = new Date('2026-05-12T08:30:00.000Z');
    const key = buildEnvScopedAssetKey({
      folder: ASSET_FOLDERS.RECEIPTS,
      fileName: 'My Receipt.PNG',
      envPrefix: 'dev',
      now,
      randomSuffix: 'abc123',
    });

    expect(key).toBe(
      `dev/finance/receipts/2026/05/12/${now.getTime()}-abc123-my_receipt.png`,
    );
  });

  it('builds product gallery rehost keys with product scoping', () => {
    const now = new Date('2026-05-12T08:30:00.000Z');
    const key = buildProductGalleryRehostKey({
      productId: 'prod-123',
      extension: 'jpg',
      envPrefix: 'dev',
      now,
      randomSuffix: 'img001',
    });

    expect(key).toBe(
      `dev/products/gallery/prod-123/2026/05/12/${now.getTime()}-img001.jpg`,
    );
  });

  it('builds a public URL that preserves path separators', () => {
    const url = buildPublicObjectUrl({
      bucket: 'dev-yannis-assets',
      key: 'dev/products/images/uploads/2026/05/12/test image.png',
    });

    expect(url).toBe(
      'https://storage.googleapis.com/dev-yannis-assets/dev/products/images/uploads/2026/05/12/test%20image.png',
    );
  });
});
