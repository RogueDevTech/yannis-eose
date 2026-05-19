import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Storage } from '@google-cloud/storage';
import {
  buildPublicObjectUrl,
  resolveObjectStorageConfig,
  type ObjectStorageConfig,
} from '@yannis/shared';

function getConfig(): ObjectStorageConfig | null {
  return resolveObjectStorageConfig(process.env);
}

function buildS3Client(config: ObjectStorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
    ...(config.accessKeyId && config.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }
      : {}),
  });
}

export function resolveObjectStorageRuntimeConfig(): ObjectStorageConfig | null {
  return getConfig();
}

export function buildObjectStoragePublicUrl(key: string): string | null {
  const config = getConfig();
  if (!config) return null;
  return buildPublicObjectUrl({
    provider: config.provider,
    bucket: config.bucket,
    key,
    publicBaseUrl: config.publicBaseUrl,
    region: config.region,
    endpoint: config.endpoint,
  });
}

export function getObjectStoragePublicOrigin(): string {
  const config = getConfig();
  if (!config) return '';
  const url = buildPublicObjectUrl({
    provider: config.provider,
    bucket: config.bucket,
    key: '__origin__',
    publicBaseUrl: config.publicBaseUrl,
    region: config.region,
    endpoint: config.endpoint,
  });
  return url.replace(/__origin__$/, '');
}

export async function putBufferToObjectStorage(args: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<boolean> {
  const config = getConfig();
  if (!config) return false;

  if (config.provider === 'gcs') {
    const keyJson = process.env['GCS_SERVICE_ACCOUNT_KEY_JSON']?.trim();
    const storage = keyJson
      ? new Storage({ projectId: config.projectId || undefined, credentials: JSON.parse(keyJson) })
      : new Storage({ projectId: config.projectId || undefined });
    await storage.bucket(config.bucket).file(args.key).save(args.body, {
      contentType: args.contentType,
      resumable: false,
    });
    return true;
  }

  const client = buildS3Client(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );
  return true;
}
