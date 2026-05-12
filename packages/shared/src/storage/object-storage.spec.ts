import { describe, expect, it } from 'vitest';
import {
  OBJECT_STORAGE_PROVIDERS,
  resolveObjectStorageConfig,
  resolveObjectStorageProvider,
} from './object-storage';
import { buildPublicObjectUrl } from './asset-storage';

describe('object storage env contract', () => {
  it('resolves GCS from generic env keys', () => {
    const config = resolveObjectStorageConfig({
      OBJECT_STORAGE_PROVIDER: 'gcs',
      OBJECT_STORAGE_BUCKET: 'dev-yannis-assets',
      OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/assets',
      ASSET_ENV_PREFIX: 'dev',
      GCP_PROJECT_ID: 'demo-project',
    });

    expect(config).toEqual({
      provider: OBJECT_STORAGE_PROVIDERS.GCS,
      bucket: 'dev-yannis-assets',
      publicBaseUrl: 'https://cdn.example.com/assets',
      assetEnvPrefix: 'dev',
      projectId: 'demo-project',
    });
  });

  it('falls back to legacy S3 env keys when provider is not explicit', () => {
    const config = resolveObjectStorageConfig({
      S3_BUCKET: 'legacy-assets',
      S3_REGION: 'eu-north-1',
      S3_ENDPOINT: 'https://s3.eu-north-1.amazonaws.com',
      ASSET_ENV_PREFIX: 'dev',
    });

    expect(resolveObjectStorageProvider({ S3_BUCKET: 'legacy-assets' })).toBe('s3');
    expect(config?.provider).toBe('s3');
    expect(config?.bucket).toBe('legacy-assets');
    expect(config?.region).toBe('eu-north-1');
    expect(config?.endpoint).toBe('https://s3.eu-north-1.amazonaws.com');
    expect(config?.forcePathStyle).toBe(true);
  });

  it('builds public object URLs for S3 when no explicit base URL is set', () => {
    const url = buildPublicObjectUrl({
      provider: 's3',
      bucket: 'legacy-assets',
      key: 'dev/finance/receipts/test.png',
      region: 'eu-north-1',
    });

    expect(url).toBe(
      'https://legacy-assets.s3.eu-north-1.amazonaws.com/dev/finance/receipts/test.png',
    );
  });
});
