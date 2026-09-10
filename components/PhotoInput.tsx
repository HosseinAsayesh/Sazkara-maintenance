'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { compressImage, setInputFile } from '@/lib/images';

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

  const [working, setWorking] = useState(false);

  /*
   * Downscale before the photo ever reaches the form.
   *
   * The input keeps the compressed File, so the surrounding <form> uploads that rather
   * than the camera's original. Doing it here rather than at submit time means the cost
   * is paid while the technician is still looking at the stand, not while they are
   * waiting on a progress bar.
   */
  const handle = async (picked: File | null) => {
    setWorking(Boolean(picked));
    const file = picked ? await compressImage(picked) : null;
    if (picked) setInputFile(inputRef.current, file);

    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
    setFileName(file?.name ?? null);
    setWorking(false);
    onChange?.(file);
  };

  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-brand-600">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative block h-36 w-full overflow-hidden rounded-lg border border-dashed border-[var(--border)] bg-white transition-colors hover:border-brand-400"
      >
        {working ? (
          <span className="flex h-full w-full items-center justify-center text-sm text-[var(--muted)]">
            …
          </span>
        ) : preview ? (
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
        onChange={(e) => void handle(e.target.files?.[0] ?? null)}
      />

      {preview ? (
        <button
          type="button"
          className="mt-1 text-xs text-red-600 hover:underline"
          onClick={() => {
            if (inputRef.current) inputRef.current.value = '';
            void handle(null);
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [count, setCount] = useState(0);

  /*
   * Compressed like the required photos, and for a stronger reason: this input takes any
   * number of files, so it is the one that can turn a report into a 20 MB upload from a
   * shop floor.
   */
  const handle = async (list: FileList | null) => {
    const picked = list ? [...list] : [];
    setCount(picked.length);
    if (!picked.length) return;

    const compressed = await Promise.all(picked.map((file) => compressImage(file)));
    try {
      const transfer = new DataTransfer();
      for (const file of compressed) transfer.items.add(file);
      if (inputRef.current) inputRef.current.files = transfer.files;
    } catch {
      // Assignment refused — the originals upload instead, which still works.
    }
  };

  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-brand-600">{t('photoOther')}</div>
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="image/*"
        multiple
        onChange={(e) => void handle(e.target.files)}
        className="block w-full text-sm text-ink-500 file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
      />
      {count > 0 ? (
        <p className="mt-1 text-xs text-[var(--muted)]">{count}</p>
      ) : null}
    </div>
  );
}
