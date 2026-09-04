'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Single-photo capture tile. `capture="environment"` makes a phone open the rear camera
 * straight away, which is what a technician standing in front of a stand wants; on
 * desktop it degrades to a normal file picker.
 */
export function PhotoInput({
  label,
  name,
  required,
  onChange,
}: {
  label: string;
  name: string;
  required?: boolean;
  onChange?: (file: File | null) => void;
}) {
  const t = useTranslations('form');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // Object URLs leak until revoked; tie each one to the preview it created.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const handle = (file: File | null) => {
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
    setFileName(file?.name ?? null);
    onChange?.(file);
  };

  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative block h-36 w-full overflow-hidden rounded-lg border border-dashed border-[var(--border)] bg-white transition-colors hover:border-brand-400"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-sm text-[var(--muted)]">
            <span className="text-2xl leading-none">+</span>
            {t('addPhoto')}
          </span>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handle(e.target.files?.[0] ?? null)}
      />

      {preview ? (
        <button
          type="button"
          className="mt-1 text-xs text-red-600 hover:underline"
          onClick={() => {
            if (inputRef.current) inputRef.current.value = '';
            handle(null);
          }}
        >
          {t('removePhoto')}
          {fileName ? ` — ${fileName}` : ''}
        </button>
      ) : null}
    </div>
  );
}

/** Optional extra photos beyond the three required ones. */
export function ExtraPhotoInput({ name }: { name: string }) {
  const t = useTranslations('form');
  const [count, setCount] = useState(0);

  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-slate-700">{t('photoOther')}</div>
      <input
        type="file"
        name={name}
        accept="image/*"
        multiple
        onChange={(e) => setCount(e.target.files?.length ?? 0)}
        className="block w-full text-sm text-slate-600 file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
      />
      {count > 0 ? (
        <p className="mt-1 text-xs text-[var(--muted)]">{count}</p>
      ) : null}
    </div>
  );
}
