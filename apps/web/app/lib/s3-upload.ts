export const S3_FOLDERS = {
  SCREENSHOTS: 'screenshots',
  RECEIPTS: 'receipts',
  DELIVERY_PROOF: 'delivery-proof',
  INVOICES: 'invoices',
  PRODUCT_IMAGES: 'product-images',
} as const;

export type S3Folder = (typeof S3_FOLDERS)[keyof typeof S3_FOLDERS];

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}

interface UploadUrlResponse {
  uploadUrl: string;
  fileUrl: string;
}

async function getPresignedUploadUrl(file: File, folder: S3Folder): Promise<UploadUrlResponse> {
  const res = await fetch('/api/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder,
      fileName: sanitizeFilename(file.name),
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

export async function uploadToS3(
  file: File,
  folder: S3Folder,
  onProgress?: (percent: number) => void,
): Promise<string> {
  onProgress?.(10);
  const { uploadUrl, fileUrl } = await getPresignedUploadUrl(file, folder);
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
