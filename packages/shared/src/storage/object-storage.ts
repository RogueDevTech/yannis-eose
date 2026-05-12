export const OBJECT_STORAGE_PROVIDERS = {
  GCS: 'gcs',
  S3: 's3',
} as const;

export type ObjectStorageProvider =
  (typeof OBJECT_STORAGE_PROVIDERS)[keyof typeof OBJECT_STORAGE_PROVIDERS];

export interface ObjectStorageConfig {
  provider: ObjectStorageProvider;
  bucket: string;
  publicBaseUrl?: string;
  assetEnvPrefix: string;
  projectId?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

type EnvMap = Record<string, string | undefined>;

function readEnv(env: EnvMap, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function normalizeObjectStorageProvider(
  value: string | undefined | null,
): ObjectStorageProvider | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === OBJECT_STORAGE_PROVIDERS.GCS) return OBJECT_STORAGE_PROVIDERS.GCS;
  if (normalized === OBJECT_STORAGE_PROVIDERS.S3) return OBJECT_STORAGE_PROVIDERS.S3;
  return null;
}

export function resolveObjectStorageProvider(env: EnvMap): ObjectStorageProvider | null {
  const explicit = normalizeObjectStorageProvider(readEnv(env, 'OBJECT_STORAGE_PROVIDER'));
  if (explicit) return explicit;
  if (readEnv(env, 'GCS_BUCKET')) return OBJECT_STORAGE_PROVIDERS.GCS;
  if (readEnv(env, 'S3_BUCKET')) return OBJECT_STORAGE_PROVIDERS.S3;
  return null;
}

export function resolveObjectStorageConfig(env: EnvMap): ObjectStorageConfig | null {
  const provider = resolveObjectStorageProvider(env);
  if (!provider) return null;

  const bucket =
    readEnv(env, 'OBJECT_STORAGE_BUCKET') ??
    (provider === OBJECT_STORAGE_PROVIDERS.GCS
      ? readEnv(env, 'GCS_BUCKET')
      : readEnv(env, 'S3_BUCKET'));
  if (!bucket) return null;

  const publicBaseUrl =
    readEnv(env, 'OBJECT_STORAGE_PUBLIC_BASE_URL') ??
    (provider === OBJECT_STORAGE_PROVIDERS.GCS
      ? readEnv(env, 'GCS_PUBLIC_BASE_URL')
      : undefined);

  const assetEnvPrefix = readEnv(env, 'ASSET_ENV_PREFIX') ?? 'dev';

  if (provider === OBJECT_STORAGE_PROVIDERS.GCS) {
    return {
      provider,
      bucket,
      publicBaseUrl,
      assetEnvPrefix,
      projectId: readEnv(env, 'GCP_PROJECT_ID'),
    };
  }

  const endpoint = readEnv(env, 'S3_ENDPOINT');
  const forcePathStyleValue = readEnv(env, 'OBJECT_STORAGE_FORCE_PATH_STYLE');
  return {
    provider,
    bucket,
    publicBaseUrl,
    assetEnvPrefix,
    region:
      readEnv(env, 'OBJECT_STORAGE_REGION') ??
      readEnv(env, 'S3_REGION') ??
      readEnv(env, 'AWS_REGION') ??
      'us-east-1',
    endpoint,
    accessKeyId: readEnv(env, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: readEnv(env, 'S3_SECRET_ACCESS_KEY'),
    forcePathStyle: forcePathStyleValue
      ? forcePathStyleValue === 'true'
      : Boolean(endpoint),
  };
}
