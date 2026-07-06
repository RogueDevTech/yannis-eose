import { useState, useCallback } from 'react';
import { MAX_PRODUCT_OFFER_IMAGES } from '@yannis/shared';
import { FileUpload } from '~/components/ui/file-upload';
import type { FileUploadUploadState } from '~/components/ui/file-upload';
import { FormField } from '~/components/ui/form-field';
import { ASSET_FOLDERS } from '~/lib/object-storage';

interface OfferImagesEditorProps {
  imageUrls: string[];
  onChange: (urls: string[]) => void;
  /** Called when the nested file upload enters uploading / idle / etc. */
  onUploadStateChange?: (state: FileUploadUploadState) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function OfferImagesEditor({
  imageUrls,
  onChange,
  onUploadStateChange,
  disabled = false,
  compact = false,
}: OfferImagesEditorProps) {
  const [uploadNonce, setUploadNonce] = useState(0);

  const appendUrl = useCallback(
    (url: string) => {
      if (!url || disabled) return;
      if (imageUrls.length >= MAX_PRODUCT_OFFER_IMAGES) return;
      if (imageUrls.includes(url)) return;
      onChange([...imageUrls, url]);
      setUploadNonce((n) => n + 1);
    },
    [disabled, imageUrls, onChange],
  );

  const removeAt = useCallback(
    (index: number) => {
      if (disabled) return;
      onChange(imageUrls.filter((_, i) => i !== index));
    },
    [disabled, imageUrls, onChange],
  );

  const atMax = imageUrls.length >= MAX_PRODUCT_OFFER_IMAGES;

  if (compact) {
    return (
      <div className="w-full min-w-0 max-w-[200px]">
        <div className="rounded-lg border border-app-border bg-app-elevated shadow-sm overflow-hidden ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
          <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-app-border bg-app-hover/90">
            <span className="text-micro font-semibold uppercase tracking-wide text-app-fg-muted">Image</span>
            <span className="text-micro text-app-fg-muted">Optional</span>
          </div>
          <div className="p-1.5 space-y-1.5">
            {imageUrls.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {imageUrls.map((url, i) => (
                  <li
                    key={`${url}-${i}`}
                    className="relative group w-14 h-14 rounded-md border border-app-border overflow-hidden bg-app-hover shrink-0"
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => removeAt(i)}
                        className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity text-micro font-medium"
                        aria-label={`Remove image ${i + 1}`}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!atMax && !disabled && (
              <FileUpload
                key={`offer-upload-${uploadNonce}`}
                folder={ASSET_FOLDERS.PRODUCT_IMAGES}
                accept="image/*"
                size="sm"
                variant="minimal"
                onUpload={(url) => {
                  if (url) appendUrl(url);
                }}
                onUploadStateChange={onUploadStateChange}
              />
            )}
            {atMax && (
              <p className="text-micro text-app-fg-muted px-0.5">Maximum {MAX_PRODUCT_OFFER_IMAGES} image reached.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-2">
      <FormField
        label="Offer images"
        hint={`Optional. Up to ${MAX_PRODUCT_OFFER_IMAGES} image(s) for this tier (forms, catalog).`}
      >
        {imageUrls.length > 0 && (
          <ul className="flex flex-wrap gap-2 mb-2">
            {imageUrls.map((url, i) => (
              <li
                key={`${url}-${i}`}
                className="relative group w-16 h-16 rounded-md border border-app-border overflow-hidden bg-app-hover shrink-0"
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium"
                    aria-label={`Remove image ${i + 1}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!atMax && !disabled && (
          <FileUpload
            key={`offer-upload-${uploadNonce}`}
            folder={ASSET_FOLDERS.PRODUCT_IMAGES}
            accept="image/*"
            label={imageUrls.length === 0 ? 'Upload images' : 'Add another image'}
            size="sm"
            onUpload={(url) => {
              if (url) appendUrl(url);
            }}
            onUploadStateChange={onUploadStateChange}
          />
        )}
        {atMax && (
          <p className="text-xs text-app-fg-muted">Maximum {MAX_PRODUCT_OFFER_IMAGES} images reached.</p>
        )}
      </FormField>
    </div>
  );
}
