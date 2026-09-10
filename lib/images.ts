/**
 * Client-side photo downscaling, applied the moment a technician takes a picture.
 *
 * A modern phone camera produces a 2 MB JPEG. A visit carries three of them plus two
 * signatures, so a single report was uploading ~6 MB — over a shop's mobile data, on the
 * kind of connection this app exists to work on. Long uploads do not fail cleanly: the
 * server can receive the whole body, save the report, and still lose the connection
 * before its reply arrives (ECONNRESET). The technician sees a failure for a report that
 * was in fact saved, submits again, and the visit is recorded twice.
 *
 * So this is not a bandwidth nicety, it is what stops duplicate fieldwork.
 *
 * 1600px on the long edge is far beyond what the evidence PDF needs — those images are
 * placed a few centimetres wide on an A4 page — and typically turns 2 MB into 200-400 KB.
 *
 * Every failure path returns the ORIGINAL file. A technician who cannot compress must
 * still be able to file their report; a slow upload beats a lost visit.
 */

/** Long edge in pixels. Comfortably above what the evidence PDF renders. */
const MAX_EDGE = 1600;

/** JPEG quality. 0.82 keeps part labels and damage legible when zoomed. */
const QUALITY = 0.82;

/** Below this, re-encoding costs more than it saves. */
const SKIP_UNDER_BYTES = 300 * 1024;

export async function compressImage(file: File): Promise<File> {
  if (typeof document === 'undefined') return file;
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= SKIP_UNDER_BYTES) return file;

  try {
    // `from-image` applies the EXIF orientation. Without it, a photo taken in portrait
    // is drawn to the canvas sideways and silently stored rotated — the camera's rotation
    // flag does not survive a redraw.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );

    // An already-small or well-compressed original can come out bigger; keep the better one.
    if (!blob || blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

/**
 * Puts a replacement File back into a native file input so the surrounding <form> submits
 * the compressed version. Assigning `input.files` needs a FileList, which only a
 * DataTransfer can construct.
 */
export function setInputFile(input: HTMLInputElement | null, file: File | null): void {
  if (!input) return;
  try {
    const transfer = new DataTransfer();
    if (file) transfer.items.add(file);
    input.files = transfer.files;
  } catch {
    // Older browsers refuse the assignment; the original selection stays in place.
  }
}
