import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { Storage } from '@google-cloud/storage';
import { GoogleAuth, Impersonated } from 'google-auth-library';
import {
  buildPublicObjectUrl,
  resolveObjectStorageConfig,
  type ObjectStorageConfig,
} from '@yannis/shared';

/**
 * Build a GCS `Storage` client. Mirrors the web signer's tiering:
 *  1. GCS_SERVICE_ACCOUNT_KEY_JSON — inline SA key.
 *  2. GCS_SIGNER_SERVICE_ACCOUNT — impersonate this SA via IAM (dev, where key
 *     downloads are disabled by org policy). Caller's user ADC signs/reads AS
 *     the SA; needs roles/iam.serviceAccountTokenCreator on it.
 *  3. Neither — plain ADC (fine for reads on a VM runtime SA).
 * Reads (download/put) work under plain ADC too, but keeping one factory means
 * the worker uses the SAME identity that signed the upload — no surprises.
 */
async function buildGcsStorage(projectId?: string): Promise<Storage> {
  const keyJson = process.env['GCS_SERVICE_ACCOUNT_KEY_JSON']?.trim();
  if (keyJson) {
    return new Storage({ projectId: projectId || undefined, credentials: JSON.parse(keyJson) });
  }
  const signerSa = process.env['GCS_SIGNER_SERVICE_ACCOUNT']?.trim();
  if (signerSa) {
    const sourceClient = await new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    }).getClient();
    const impersonated = new Impersonated({
      sourceClient,
      targetPrincipal: signerSa,
      targetScopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
      lifetime: 3600,
    });
    return new Storage({ projectId: projectId || undefined, authClient: impersonated });
  }
  return new Storage({ projectId: projectId || undefined });
}

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
    const storage = await buildGcsStorage(config.projectId);
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

/**
 * Stream an object out of storage by key. Used by the resumable bulk importer to
 * read a large uploaded Excel/CSV WITHOUT materialising the whole file in memory
 * — callers pipe this straight into a streaming parser. Returns null when object
 * storage isn't configured; throws if the object is missing/unreadable.
 *
 * The returned stream is a Node `Readable` for both providers (GCS
 * `createReadStream()` and the S3 SDK's `Body`, which is a `Readable` in Node).
 */
export async function getObjectStreamFromStorage(
  key: string,
): Promise<Readable | null> {
  const config = getConfig();
  if (!config) return null;

  if (config.provider === 'gcs') {
    const storage = await buildGcsStorage(config.projectId);
    return storage.bucket(config.bucket).file(key).createReadStream() as unknown as Readable;
  }

  const client = buildS3Client(config);
  const res = await client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
  );
  if (!res.Body) {
    throw new Error(`Empty object body for key ${key}`);
  }
  // In the Node runtime the AWS SDK v3 Body is a Readable stream.
  return res.Body as Readable;
}

/**
 * Download an object fully into a Buffer. Fallback for parsers that cannot
 * consume a stream (e.g. SheetJS). Prefer `getObjectStreamFromStorage` for large
 * files. Returns null when storage isn't configured.
 */
export async function getObjectBufferFromStorage(
  key: string,
): Promise<Buffer | null> {
  const stream = await getObjectStreamFromStorage(key);
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
