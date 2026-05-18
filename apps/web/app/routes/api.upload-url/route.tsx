import type { ActionFunctionArgs } from '@remix-run/node';
import {
  ASSET_FOLDERS,
  type AssetFolder,
} from '@yannis/shared';
import { getCurrentUser } from '~/lib/api.server';
import { createSignedAssetUpload } from '~/lib/object-storage.server';

const ALLOWED_FOLDERS = new Set<AssetFolder>(Object.values(ASSET_FOLDERS));
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

interface UploadUrlRequest {
  folder?: AssetFolder;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
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
  // Mirror Mode is strictly view-only — direct asset uploads bypass the tRPC mutation block, so we
  // must reject them here too. Otherwise an admin mirroring a staff member could write
  // files into their folder. See CLAUDE.md → "Mirror Mode".
  if (user.mirroredBy) {
    return jsonResponse(
      { error: 'Read-only while mirroring user. Exit mirror mode to upload files.' },
      403,
    );
  }

  const body = (await request.json().catch(() => ({}))) as UploadUrlRequest;
  const folder = body.folder;
  const fileName = body.fileName ?? '';
  const fileType = body.fileType ?? 'application/octet-stream';
  const fileSize = Number(body.fileSize ?? 0);

  if (!folder || !ALLOWED_FOLDERS.has(folder)) {
    return jsonResponse({ error: 'Invalid upload folder' }, 400);
  }
  if (!fileName || fileName.length > 255) {
    return jsonResponse({ error: 'Invalid file name' }, 400);
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE_BYTES) {
    return jsonResponse({ error: 'Invalid file size' }, 400);
  }

  const signedUpload = await createSignedAssetUpload({
    folder,
    fileName,
    fileType,
  });
  if (!signedUpload) {
    return jsonResponse({ error: 'Upload service not configured' }, 503);
  }

  return jsonResponse(signedUpload);
}
