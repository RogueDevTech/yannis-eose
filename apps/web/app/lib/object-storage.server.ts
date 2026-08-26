import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Storage } from '@google-cloud/storage';
import { GoogleAuth, Impersonated } from 'google-auth-library';
import {
  buildEnvScopedAssetKey,
  buildPublicObjectUrl,
  resolveObjectStorageConfig,
  sanitizeAssetFileName,
  type AssetFolder,
} from '@yannis/shared';

/**
 * Build a GCS `Storage` client that can SIGN v4 upload URLs.
 *
 * Signing needs a service-account identity (a private key or IAM signBlob).
 * Three tiers, in priority order:
 *  1. `GCS_SERVICE_ACCOUNT_KEY_JSON` — inline SA key (prod/Docker where the
 *     metadata server isn't reachable). Signs directly with the private key.
 *  2. `GCS_SIGNER_SERVICE_ACCOUNT` — SA email to IMPERSONATE. Used in dev where
 *     the org blocks SA key downloads (constraints/iam.disableServiceAccountKeyCreation):
 *     the caller runs as a USER (ADC) and signs blobs AS the SA via the IAM API.
 *     The user needs roles/iam.serviceAccountTokenCreator on that SA.
 *  3. Neither — plain ADC. Works for read/write on a VM whose runtime SA has a
 *     usable signer, but CANNOT sign under a user ADC (throws
 *     "Cannot sign data without client_email").
 */
async function buildGcsStorage(projectId?: string): Promise<Storage> {
  const keyJson = process.env['GCS_SERVICE_ACCOUNT_KEY_JSON']?.trim();
  if (keyJson) {
    return new Storage({ projectId: projectId || undefined, credentials: JSON.parse(keyJson) });
  }
  const signerSa = process.env['GCS_SIGNER_SERVICE_ACCOUNT']?.trim();
  if (signerSa) {
    // Resolve the caller's own ADC client, then wrap it to sign AS the SA via
    // the IAM signBlob API (no private key involved).
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
    // Signing needs an SA identity: inline key, impersonation, or (unusable for
    // signing) plain user ADC. See buildGcsStorage.
    const storage = await buildGcsStorage(config.projectId);
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
