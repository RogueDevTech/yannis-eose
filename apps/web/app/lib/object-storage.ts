import { ASSET_FOLDERS, type AssetFolder, sanitizeAssetFileName } from '@yannis/shared';

export { ASSET_FOLDERS };
export type { AssetFolder };

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
  onProgress?.(10);
  const { uploadUrl, fileUrl, key } = await getSignedUploadUrl(file, folder);
  onProgress?.(35);
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!uploadRes.ok) {
    throw new Error('Upload failed');
  }

  onProgress?.(100);
  return { fileUrl, key };
}
