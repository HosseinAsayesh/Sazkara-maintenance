/**
 * Storage adapter.
 *
 * Everything that writes a file (photos, signatures, uploaded Excel originals,
 * generated exports and evidence PDFs) goes through this interface and stores only the
 * returned opaque `ref` in the database. Moving to S3-compatible object storage later
 * means writing one new implementation and changing the `switch` in `getStorage()` —
 * no call site changes, no data migration beyond copying the files.
 */

export interface PutOptions {
  contentType?: string;
  /** Logical folder, e.g. `photos/2026-09-04`. */
  prefix?: string;
  /** Preferred file name; the adapter may add a uniqueness suffix. */
  filename?: string;
}

export interface StorageAdapter {
  /** Persist bytes and return the opaque ref to store in the DB. */
  put(data: Buffer | Uint8Array, opts?: PutOptions): Promise<string>;
  get(ref: string): Promise<Buffer>;
  exists(ref: string): Promise<boolean>;
  delete(ref: string): Promise<void>;
  /**
   * URL the browser can fetch this ref from. For local disk that is an
   * authenticated route handler; an S3 adapter would return a signed URL.
   */
  url(ref: string): string;
  contentTypeOf(ref: string): string;
}

let cached: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cached) return cached;

  const driver = process.env.STORAGE_DRIVER || 'local';
  switch (driver) {
    case 'local': {
      // Lazy require keeps `fs` out of any bundle that only needs the types.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { LocalDiskStorage } = require('./local') as typeof import('./local');
      cached = new LocalDiskStorage();
      return cached;
    }
    default:
      throw new Error(
        `Unknown STORAGE_DRIVER "${driver}". Supported: "local". ` +
          'Add a new adapter under lib/storage/ and register it here.',
      );
  }
}

const EXT_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
};

export function contentTypeForExtension(ext: string): string {
  return EXT_CONTENT_TYPES[ext.toLowerCase()] || 'application/octet-stream';
}

export function extensionForContentType(contentType: string): string {
  const found = Object.entries(EXT_CONTENT_TYPES).find(([, v]) => v === contentType);
  return found ? found[0] : '.bin';
}
