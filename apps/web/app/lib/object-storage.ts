import { ASSET_FOLDERS, type AssetFolder, sanitizeAssetFileName } from '@yannis/shared';

export { ASSET_FOLDERS };
export type { AssetFolder };

/**
 * Wall-clock ceiling for the direct-to-storage PUT, so a stalled upload fails
 * loudly instead of hanging forever.
 *
 * NOTE this is TOTAL duration, not idle time — XHR has no inactivity timeout.
 * It is therefore set generously: a 100 MB import (the cap for the `imports`
 * folder) needs ~30 min on a slow 0.5 Mbps uplink, and killing a genuinely
 * progressing upload would be worse than the hang this fixes.
 */
const UPLOAD_TIMEOUT_MS = 45 * 60 * 1000;

interface UploadUrlResponse {
  uploadUrl: string;
  fileUrl: string;
  /** Object-storage key — needed by server-side consumers (e.g. bulk importer). */
  key?: string;
}

async function getSignedUploadUrl(file: File, folder: AssetFolder): Promise<UploadUrlResponse> {
  const res = await fetch('/api/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder,
      fileName: sanitizeAssetFileName(file.name),
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<UploadUrlResponse> & { error?: string };
  if (!res.ok || !data.uploadUrl || !data.fileUrl) {
    throw new Error(data.error ?? 'Unable to start upload');
  }
  return { uploadUrl: data.uploadUrl, fileUrl: data.fileUrl, key: data.key };
}

export interface UploadedAsset {
  fileUrl: string;
  /** Object-storage key (may be undefined on older responses). */
  key?: string;
}

/**
 * Upload and return just the public URL (back-compat default). Most callers only
 * need the URL for `<img>` / links.
 */
export async function uploadAsset(
  file: File,
  folder: AssetFolder,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const { fileUrl } = await uploadAssetDetailed(file, folder, onProgress);
  return fileUrl;
}

/**
 * Upload and return both the public URL and the storage key. Used by the bulk
 * importer, which hands the key to the server so the background worker can
 * download the file.
 */
export async function uploadAssetDetailed(
  file: File,
  folder: AssetFolder,
  onProgress?: (percent: number) => void,
): Promise<UploadedAsset> {
  // Presign step (~first 5%). The PUT itself is 5→100% via real byte progress.
  onProgress?.(2);
  const { uploadUrl, fileUrl, key } = await getSignedUploadUrl(file, folder);
  onProgress?.(5);

  // Use XHR (not fetch) so we get real upload progress events for the bar.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    // Without a timeout a stalled PUT (dropped connection, proxy black-hole)
    // never settles this promise: the progress bar parks forever and the caller
    // shows neither success nor error.
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.ontimeout = () =>
      reject(new Error('Upload timed out. Check your connection and try again.'));
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      // Map bytes 0..100% onto the 5..100% band (presign already used 0..5%).
      const pct = 5 + Math.round((e.loaded / e.total) * 95);
      onProgress?.(Math.min(99, pct));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(file);
  });

  return { fileUrl, key };
}
