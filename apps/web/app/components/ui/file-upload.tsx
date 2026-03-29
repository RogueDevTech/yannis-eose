import { useState, useRef, useCallback } from 'react';
import { uploadToS3, type S3Folder } from '~/lib/s3-upload';

interface FileUploadProps {
  folder: S3Folder;
  onUpload: (url: string) => void;
  accept?: string;
  maxSizeMB?: number;
  label?: string;
  name?: string;
  required?: boolean;
}

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

export function FileUpload({
  folder,
  onUpload,
  accept = 'image/*',
  maxSizeMB = 10,
  label,
  name,
  required,
}: FileUploadProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [uploadedUrl, setUploadedUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFileSelect = useCallback(
    async (file: File) => {
      setError('');

      if (file.size > maxSizeMB * 1024 * 1024) {
        setError(`File too large. Maximum size is ${maxSizeMB}MB.`);
        return;
      }

      setFileName(file.name);
      setFileSize(formatSize(file.size));
      setState('uploading');
      setProgress(0);

      // Show preview for images
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => setPreviewUrl(e.target?.result as string);
        reader.readAsDataURL(file);
      }

      try {
        const url = await uploadToS3(file, folder, setProgress);
        setUploadedUrl(url);
        setState('done');
        onUpload(url);
      } catch (err) {
        setState('error');
        setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      }
    },
    [folder, maxSizeMB, onUpload],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleRemove = () => {
    setState('idle');
    setUploadedUrl('');
    setFileName('');
    setFileSize('');
    setPreviewUrl('');
    setProgress(0);
    setError('');
    onUpload('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-app-fg-muted mb-1">
          {label} {required && <span className="text-danger-500">*</span>}
        </label>
      )}

      {/* Hidden input to pass URL to form */}
      {name && <input type="hidden" name={name} value={uploadedUrl} />}

      {state === 'idle' && (
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-app-border rounded-lg p-4 text-center cursor-pointer hover:border-brand-400 dark:hover:border-brand-500 hover:bg-app-hover/50 transition-colors"
        >
          <svg
            className="w-8 h-8 mx-auto text-app-fg-muted mb-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
            />
          </svg>
          <p className="text-sm text-app-fg-muted">
            Click or drag file to upload
          </p>
          <p className="text-xs text-app-fg-muted mt-1">
            Max {maxSizeMB}MB
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            onChange={handleInputChange}
            className="hidden"
          />
        </div>
      )}

      {state === 'uploading' && (
        <div className="border border-app-border rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-brand-500 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm text-app-fg-muted truncate">{fileName}</span>
            <span className="text-xs text-app-fg-muted ml-auto">{fileSize}</span>
          </div>
          <div className="w-full bg-app-hover rounded-full h-1.5">
            <div
              className="bg-brand-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {state === 'done' && (
        <div className="border border-success-200 dark:border-success-700/50 bg-success-50/50 dark:bg-success-900/10 rounded-lg p-3">
          <div className="flex items-start gap-3">
            {previewUrl && (
              <img src={previewUrl} alt="Preview" className="w-12 h-12 rounded object-cover flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-app-fg truncate">{fileName}</p>
              <p className="text-xs text-app-fg-muted">{fileSize}</p>
            </div>
            <button
              type="button"
              onClick={handleRemove}
              className="text-app-fg-muted hover:text-danger-500 dark:text-surface-200 transition-colors flex-shrink-0"
              title="Remove"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="space-y-2">
          <div className="border border-danger-200 dark:border-danger-700/50 bg-danger-50/50 dark:bg-danger-900/10 rounded-lg p-3">
            <p className="text-sm text-danger-700 dark:text-danger-400">{error}</p>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
