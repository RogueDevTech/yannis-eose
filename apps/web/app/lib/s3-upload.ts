// Backward-compatible shim while callers migrate off S3-specific naming.
export {
  ASSET_FOLDERS as S3_FOLDERS,
  uploadAsset as uploadToS3,
  type AssetFolder as S3Folder,
} from './object-storage';
