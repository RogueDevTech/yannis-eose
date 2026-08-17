import type { ActionFunctionArgs } from '@remix-run/node';
import {
  ASSET_FOLDERS,
  resolveAssetMaxBytes,
  type AssetFolder,
} from '@yannis/shared';
import { getCurrentUser } from '~/lib/api.server';
import { createSignedAssetUpload } from '~/lib/object-storage.server';

const ALLOWED_FOLDERS = new Set<AssetFolder>(Object.values(ASSET_FOLDERS));
// Authoritative per-folder size cap — a hand-crafted POST cannot bypass it.
// Images default to 2 MB (CEO directive); onboarding documents get 10 MB. The
// client-side `FileUpload` pre-validates the SAME per-folder number, so the two
// checks stay in lockstep. See `resolveAssetMaxBytes` in @yannis/shared.

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
  const maxFileSizeBytes = resolveAssetMaxBytes(folder);
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > maxFileSizeBytes) {
    const maxMb = Math.round(maxFileSizeBytes / (1024 * 1024));
    return jsonResponse({ error: `File too large. Maximum size is ${maxMb}MB.` }, 400);
  }

  let signedUpload;
  try {
    signedUpload = await createSignedAssetUpload({ folder, fileName, fileType });
  } catch (err) {
    // Presign can throw at runtime even when storage IS configured — most often
    // GCS v4 signing under ADC without the `iam.serviceAccounts.signBlob`
    // permission (grant Token Creator on the runtime SA), or S3 credential
    // errors. Surface a clear, logged message instead of a bare 500 so the
    // client stops showing the useless generic "Unable to start upload".
    console.error('[upload-url] presign failed', {
      folder,
      message: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(
      { error: 'Upload service is misconfigured. Please contact support.' },
      503,
    );
  }
  if (!signedUpload) {
    return jsonResponse({ error: 'Upload service not configured' }, 503);
  }

  return jsonResponse(signedUpload);
}
