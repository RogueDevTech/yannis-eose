import type { ActionFunctionArgs } from '@remix-run/node';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getCurrentUser } from '~/lib/api.server';

const ALLOWED_FOLDERS = new Set(['screenshots', 'receipts', 'delivery-proof', 'invoices']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

interface UploadUrlRequest {
  folder?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').toLowerCase();
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const user = await getCurrentUser(request);
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const body = (await request.json().catch(() => ({}))) as UploadUrlRequest;
  const folder = body.folder ?? '';
  const fileName = body.fileName ?? '';
  const fileType = body.fileType ?? 'application/octet-stream';
  const fileSize = Number(body.fileSize ?? 0);

  if (!ALLOWED_FOLDERS.has(folder)) {
    return jsonResponse({ error: 'Invalid upload folder' }, 400);
  }
  if (!fileName || fileName.length > 255) {
    return jsonResponse({ error: 'Invalid file name' }, 400);
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE_BYTES) {
    return jsonResponse({ error: 'Invalid file size' }, 400);
  }

  const bucket = process.env['S3_BUCKET'] ?? '';
  const region = process.env['S3_REGION'] ?? 'us-east-1';
  const endpoint = process.env['S3_ENDPOINT'] ?? '';
  const accessKeyId = process.env['S3_ACCESS_KEY_ID'] ?? '';
  const secretAccessKey = process.env['S3_SECRET_ACCESS_KEY'] ?? '';

  if (!bucket || !accessKeyId || !secretAccessKey) {
    return jsonResponse({ error: 'Upload service not configured' }, 503);
  }

  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const key = `${folder}/${timestamp}-${random}-${sanitizeFilename(fileName)}`;

  const client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: fileType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 120 });
  const fileUrl = endpoint
    ? `${endpoint}/${bucket}/${key}`
    : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

  return jsonResponse({ uploadUrl, fileUrl, key });
}
