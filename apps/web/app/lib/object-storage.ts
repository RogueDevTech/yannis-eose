import { ASSET_FOLDERS, type AssetFolder, sanitizeAssetFileName } from '@yannis/shared';

export { ASSET_FOLDERS };
export type { AssetFolder };

interface UploadUrlResponse {
  uploadUrl: string;
  fileUrl: string;
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
  return { uploadUrl: data.uploadUrl, fileUrl: data.fileUrl };
}

export async function uploadAsset(
  file: File,
  folder: AssetFolder,
  onProgress?: (percent: number) => void,
): Promise<string> {
  onProgress?.(10);
  const { uploadUrl, fileUrl } = await getSignedUploadUrl(file, folder);
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
  return fileUrl;
}
