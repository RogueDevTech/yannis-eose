import { useState, useRef, useCallback, useEffect } from 'react';
import { uploadToS3, type S3Folder } from '~/lib/s3-upload';

export type FileUploadUploadState = 'idle' | 'uploading' | 'done' | 'error';

interface FileUploadProps {
  folder: S3Folder;
  onUpload: (url: string) => void;
  accept?: string;
  maxSizeMB?: number;
  label?: string;
  /**
   * When set, a hidden input submits the uploaded URL with the form.
   * HTML5 `required` does not apply to hidden inputs — parents must validate the URL
   * (e.g. Zod + intercept submit) or disable submit until `onUpload` receives a non-empty URL.
   */
  name?: string;
  /** Visual-only asterisk; does not enable browser validation for `name` hidden fields. */
  required?: boolean;
  /** Fires whenever internal upload phase changes (use to disable submit while uploading). */
  onUploadStateChange?: (state: FileUploadUploadState) => void;
  /** Use a compact picker variant for tight form layouts. */
  size?: 'md' | 'sm';
  /** Minimal dropzone for dense grids (icon + short copy; no tall drag hint stack). */
  variant?: 'default' | 'minimal';
}

type UploadState = FileUploadUploadState;

export function FileUpload({
  folder,
  onUpload,
  accept = 'image/*',
  maxSizeMB = 10,
  label,
  name,
  required,
  onUploadStateChange,
  size = 'md',
  variant = 'default',
}: FileUploadProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [uploadedUrl, setUploadedUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<UploadState>('idle');
  // Pin the callback in a ref so we can fire it from effects WITHOUT putting it
  // in the dependency array. Inline arrows from parents (`(s) => updateLine(...)`)
  // change identity on every render — including them in deps creates an
  // infinite loop because the effect refires → parent re-renders → new arrow →
  // effect refires. The ref always points at the latest callback.
  const onUploadStateChangeRef = useRef(onUploadStateChange);
  useEffect(() => {
    onUploadStateChangeRef.current = onUploadStateChange;
  });

  useEffect(() => {
    stateRef.current = state;
    onUploadStateChangeRef.current?.(state);
  }, [state]);

  useEffect(
    () => () => {
      // If the component unmounts mid-upload (e.g. picker hidden after max images),
      // ensure parents relying on upload state don't stay stuck in "uploading".
      if (stateRef.current === 'uploading') {
        onUploadStateChangeRef.current?.('idle');
      }
    },
    [],
  );

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
          className={
            variant === 'minimal'
              ? // Mirror the TextInput md size + chrome (`h-9`, `rounded-lg`, solid
                // `border-app-border`, `bg-app-canvas`) so this dropzone aligns
                // visually with sibling text/select inputs in dense grids.
                'flex items-center gap-2 h-9 px-3 border border-app-border rounded-lg bg-app-canvas cursor-pointer hover:border-brand-400 dark:hover:border-brand-500 transition-colors text-left'
              : `border-2 border-dashed border-app-border rounded-lg text-center cursor-pointer hover:border-brand-400 dark:hover:border-brand-500 hover:bg-app-hover/50 transition-colors ${
                  size === 'sm' ? 'p-2.5' : 'p-4'
                }`
          }
        >
          {variant === 'minimal' ? (
            <>
              <svg
                className="w-4 h-4 shrink-0 text-app-fg-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
                />
              </svg>
              <span className="text-sm text-app-fg-muted truncate">
                Choose file <span className="text-[11px]">· max {maxSizeMB}MB</span>
              </span>
            </>
          ) : (
            <>
              <svg
                className={`${size === 'sm' ? 'w-5 h-5 mb-1.5' : 'w-8 h-8 mb-2'} mx-auto text-app-fg-muted`}
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
              <p className={`${size === 'sm' ? 'text-xs' : 'text-sm'} text-app-fg-muted`}>
                Click or drag file to upload
              </p>
              <p className={`${size === 'sm' ? 'text-[10px] mt-0.5' : 'text-xs mt-1'} text-app-fg-muted`}>
                Max {maxSizeMB}MB
              </p>
            </>
          )}
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
        <div
          className={
            variant === 'minimal'
              ? 'border border-app-border rounded-lg p-2 space-y-1.5'
              : 'border border-app-border rounded-lg p-4 space-y-2'
          }
        >
          <div className="flex items-center gap-2">
            <svg
              className={`text-brand-500 animate-spin ${variant === 'minimal' ? 'w-3.5 h-3.5' : 'w-4 h-4'}`}
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span
              className={`text-app-fg-muted truncate ${variant === 'minimal' ? 'text-xs' : 'text-sm'}`}
            >
              {fileName}
            </span>
            <span className={`text-app-fg-muted ml-auto ${variant === 'minimal' ? 'text-[10px]' : 'text-xs'}`}>
              {fileSize}
            </span>
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
        <div
          className={
            variant === 'minimal'
              ? 'border border-success-200 dark:border-success-700/50 bg-success-50/50 dark:bg-success-900/10 rounded-lg p-2'
              : 'border border-success-200 dark:border-success-700/50 bg-success-50/50 dark:bg-success-900/10 rounded-lg p-3'
          }
        >
          <div className={`flex items-start gap-3 ${variant === 'minimal' ? 'gap-2' : ''}`}>
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Preview"
                className={`rounded object-cover flex-shrink-0 ${variant === 'minimal' ? 'w-10 h-10' : 'w-12 h-12'}`}
              />
            )}
            <div className="flex-1 min-w-0">
              <p className={`font-medium text-app-fg truncate ${variant === 'minimal' ? 'text-xs' : 'text-sm'}`}>
                {fileName}
              </p>
              <p className={`text-app-fg-muted ${variant === 'minimal' ? 'text-[10px]' : 'text-xs'}`}>{fileSize}</p>
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
          <div
            className={
              variant === 'minimal'
                ? 'border border-danger-200 dark:border-danger-700/50 bg-danger-50/50 dark:bg-danger-900/10 rounded-lg p-2'
                : 'border border-danger-200 dark:border-danger-700/50 bg-danger-50/50 dark:bg-danger-900/10 rounded-lg p-3'
            }
          >
            <p
              className={`text-danger-700 dark:text-danger-400 ${variant === 'minimal' ? 'text-xs' : 'text-sm'}`}
            >
              {error}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            className={`text-brand-600 dark:text-brand-400 hover:underline ${
              variant === 'minimal' ? 'text-xs' : 'text-sm'
            }`}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
