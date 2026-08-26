import type { ObjectStorageProvider } from './object-storage';

export const ASSET_FOLDERS = {
  SCREENSHOTS: 'screenshots',
  RECEIPTS: 'receipts',
  DELIVERY_PROOF: 'delivery-proof',
  INVOICES: 'invoices',
  PRODUCT_IMAGES: 'product-images',
  ONBOARDING_DOCS: 'onboarding-docs',
  TAX_DOCS: 'tax-docs',
  // Bulk-import source files (Excel/CSV CRM exports). Large; processed
  // server-side by the resumable importer, never rendered in the browser.
  IMPORTS: 'imports',
} as const;

export type AssetFolder = (typeof ASSET_FOLDERS)[keyof typeof ASSET_FOLDERS];

/**
 * Platform-wide default upload cap: 2 MB on images (CEO directive). This is the
 * baseline every folder inherits unless it opts into a larger cap below.
 */
export const DEFAULT_ASSET_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Per-folder upload size caps. Most folders hold images and keep the 2 MB
 * default. Onboarding documents (utility bills, bank statements, ID / passport
 * scans, signed contracts) are routinely larger than 2 MB, so they get 10 MB —
 * matching the "≤10MB" the onboarding form advertises to staff.
 *
 * Single source of truth: both the client `FileUpload` and the server
 * `/api/upload-url` validator read this, so the promise, the client check, and
 * the authoritative server check can never drift apart.
 */
const ASSET_FOLDER_MAX_BYTES: Partial<Record<AssetFolder, number>> = {
  'onboarding-docs': 10 * 1024 * 1024,
  // Tax documents (TIN certificates, tax cards, PAYE receipts) are PDFs/scans,
  // routinely larger than the 2 MB image default — match onboarding's 10 MB.
  'tax-docs': 10 * 1024 * 1024,
  // Bulk-import CRM exports can be 100k+ rows. A 100k-row XLSX is ~15-30 MB;
  // CSV larger. 100 MB gives generous headroom. The file is streamed row-by-row
  // server-side (never fully materialised), so a big cap is safe here.
  imports: 100 * 1024 * 1024,
};

export function resolveAssetMaxBytes(folder: AssetFolder): number {
  return ASSET_FOLDER_MAX_BYTES[folder] ?? DEFAULT_ASSET_MAX_BYTES;
}

const ASSET_FOLDER_PREFIXES: Record<AssetFolder, string> = {
  screenshots: 'marketing/screenshots',
  receipts: 'finance/receipts',
  'delivery-proof': 'logistics/delivery-proof',
  invoices: 'finance/invoices',
  'product-images': 'products/images/uploads',
  'onboarding-docs': 'hr/onboarding-docs',
  'tax-docs': 'hr/tax-docs',
  imports: 'imports/uploads',
};

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/-{2,}/g, '-')
    .replace(/^[/_-]+|[/_-]+$/g, '');
  return sanitized || fallback;
}

export function sanitizeAssetFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}

export function normalizeAssetEnvPrefix(prefix: string | undefined | null): string {
  return sanitizePathSegment(prefix ?? '', 'dev');
}

export function resolveAssetFolderPrefix(folder: AssetFolder): string {
  return ASSET_FOLDER_PREFIXES[folder];
}

export interface BuildAssetKeyArgs {
  folder: AssetFolder;
  fileName: string;
  envPrefix?: string | null;
  now?: Date;
  randomSuffix?: string;
}

export function buildEnvScopedAssetKey(args: BuildAssetKeyArgs): string {
  const now = args.now ?? new Date();
  const envPrefix = normalizeAssetEnvPrefix(args.envPrefix);
  const folderPrefix = resolveAssetFolderPrefix(args.folder);
  const randomSuffix = sanitizePathSegment(
    args.randomSuffix ?? Math.random().toString(36).slice(2, 8),
    'upload',
  );
  const yyyy = now.getFullYear();
  const mm = padDatePart(now.getMonth() + 1);
  const dd = padDatePart(now.getDate());
  const fileName = sanitizeAssetFileName(args.fileName);

  return `${envPrefix}/${folderPrefix}/${yyyy}/${mm}/${dd}/${now.getTime()}-${randomSuffix}-${fileName}`;
}

export interface BuildProductGalleryRehostKeyArgs {
  productId: string;
  extension: string;
  envPrefix?: string | null;
  now?: Date;
  randomSuffix?: string;
}

export function normalizeAssetExtension(extension: string): string {
  const trimmed = extension.trim().toLowerCase();
  if (!trimmed) return '.bin';
  const withDot = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  return /^\.[a-z0-9]{2,10}$/.test(withDot) ? withDot : '.bin';
}

export function buildProductGalleryRehostKey(args: BuildProductGalleryRehostKeyArgs): string {
  const now = args.now ?? new Date();
  const envPrefix = normalizeAssetEnvPrefix(args.envPrefix);
  const randomSuffix = sanitizePathSegment(
    args.randomSuffix ?? Math.random().toString(36).slice(2, 8),
    'rehost',
  );
  const yyyy = now.getFullYear();
  const mm = padDatePart(now.getMonth() + 1);
  const dd = padDatePart(now.getDate());
  const safeProductId = sanitizePathSegment(args.productId, 'unknown-product');
  const extension = normalizeAssetExtension(args.extension);

  return `${envPrefix}/products/gallery/${safeProductId}/${yyyy}/${mm}/${dd}/${now.getTime()}-${randomSuffix}${extension}`;
}

function encodeObjectKey(key: string): string {
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export interface BuildPublicObjectUrlArgs {
  provider?: ObjectStorageProvider | null;
  bucket: string;
  key: string;
  publicBaseUrl?: string | null;
  region?: string | null;
  endpoint?: string | null;
}

export function buildPublicObjectUrl(args: BuildPublicObjectUrlArgs): string {
  const bucket = args.bucket.trim();
  let baseUrl = args.publicBaseUrl?.trim()
    ? args.publicBaseUrl.replace(/\/$/, '')
    : '';
  if (!baseUrl) {
    if (args.provider === 's3') {
      const endpoint = args.endpoint?.trim();
      if (endpoint) {
        baseUrl = `${endpoint.replace(/\/$/, '')}/${bucket}`;
      } else {
        const region = args.region?.trim() || 'us-east-1';
        baseUrl = `https://${bucket}.s3.${region}.amazonaws.com`;
      }
    } else {
      baseUrl = `https://storage.googleapis.com/${bucket}`;
    }
  }
  return `${baseUrl}/${encodeObjectKey(args.key)}`;
}
