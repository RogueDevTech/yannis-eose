import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export const S3_FOLDERS = {
  SCREENSHOTS: 'screenshots',
  RECEIPTS: 'receipts',
  DELIVERY_PROOF: 'delivery-proof',
  INVOICES: 'invoices',
} as const;

export type S3Folder = (typeof S3_FOLDERS)[keyof typeof S3_FOLDERS];

function getS3Client(): S3Client {
  const env = window.__ENV;
  const config: ConstructorParameters<typeof S3Client>[0] = {
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  };
  if (env.S3_ENDPOINT) {
    config.endpoint = env.S3_ENDPOINT;
    config.forcePathStyle = true;
  }
  return new S3Client(config);
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}

export async function uploadToS3(
  file: File,
  folder: S3Folder,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const env = window.__ENV;
  const client = getS3Client();

  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const sanitized = sanitizeFilename(file.name);
  const key = `${folder}/${timestamp}-${random}-${sanitized}`;

  const arrayBuffer = await file.arrayBuffer();

  // Simulate progress since S3 PutObject doesn't provide it natively
  onProgress?.(10);

  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: new Uint8Array(arrayBuffer),
      ContentType: file.type,
    }),
  );

  onProgress?.(100);

  // Build the public URL
  if (env.S3_ENDPOINT) {
    return `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`;
  }
  return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${key}`;
}
