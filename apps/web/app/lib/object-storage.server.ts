import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Storage } from '@google-cloud/storage';
import {
  buildEnvScopedAssetKey,
  buildPublicObjectUrl,
  resolveObjectStorageConfig,
  sanitizeAssetFileName,
  type AssetFolder,
} from '@yannis/shared';

export interface SignedAssetUpload {
  uploadUrl: string;
  fileUrl: string;
  key: string;
}

function buildS3ClientFromEnv() {
  const config = resolveObjectStorageConfig(process.env);
  if (!config || config.provider !== 's3') return null;
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

export async function createSignedAssetUpload(args: {
  folder: AssetFolder;
  fileName: string;
  fileType: string;
}): Promise<SignedAssetUpload | null> {
  const config = resolveObjectStorageConfig(process.env);
  if (!config) return null;

  const key = buildEnvScopedAssetKey({
    folder: args.folder,
    fileName: sanitizeAssetFileName(args.fileName),
    envPrefix: config.assetEnvPrefix,
  });

  if (config.provider === 'gcs') {
    // Inside Docker on GCE the metadata server isn't reachable by default,
    // so ADC fails. Support an inline service-account key via env var.
    const keyJson = process.env['GCS_SERVICE_ACCOUNT_KEY_JSON']?.trim();
    const storage = keyJson
      ? new Storage({ projectId: config.projectId || undefined, credentials: JSON.parse(keyJson) })
      : new Storage({ projectId: config.projectId || undefined });
    const [uploadUrl] = await storage.bucket(config.bucket).file(key).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 120_000,
      contentType: args.fileType,
    });
    return {
      uploadUrl,
      fileUrl: buildPublicObjectUrl({
        provider: config.provider,
        bucket: config.bucket,
        key,
        publicBaseUrl: config.publicBaseUrl,
      }),
      key,
    };
  }

  const client = buildS3ClientFromEnv();
  if (!client) return null;
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: args.fileType,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 120 });
  return {
    uploadUrl,
    fileUrl: buildPublicObjectUrl({
      provider: config.provider,
      bucket: config.bucket,
      key,
      publicBaseUrl: config.publicBaseUrl,
      region: config.region,
      endpoint: config.endpoint,
    }),
    key,
  };
}
