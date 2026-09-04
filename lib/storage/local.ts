import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  contentTypeForExtension,
  type PutOptions,
  type StorageAdapter,
} from './index';

/**
 * Local-disk implementation. Files live under UPLOADS_DIR (default `./uploads`), which
 * is deliberately OUTSIDE `public/` — reads go through `/api/files/[...ref]`, which
 * checks the session first. Refs are relative POSIX paths like
 * `photos/2026-09-04/a1b2c3d4.jpg`.
 */
export class LocalDiskStorage implements StorageAdapter {
  private readonly root: string;

  constructor(root = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads')) {
    this.root = path.resolve(root);
  }

  /** Reject anything that would escape the uploads root. */
  private resolveRef(ref: string): string {
    const normalised = path.posix.normalize(ref.replace(/\\/g, '/'));
    if (
      !normalised ||
      normalised.startsWith('/') ||
      normalised.split('/').some((seg) => seg === '..')
    ) {
      throw new Error(`Invalid storage ref: ${ref}`);
    }
    const full = path.resolve(this.root, normalised);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`Storage ref escapes the uploads root: ${ref}`);
    }
    return full;
  }

  async put(data: Buffer | Uint8Array, opts: PutOptions = {}): Promise<string> {
    const prefix = (opts.prefix ?? 'misc').replace(/^\/+|\/+$/g, '');
    const ext = opts.filename ? path.extname(opts.filename) : '';
    const base = randomBytes(12).toString('hex');
    const safeName = opts.filename
      ? `${base}-${path
          .basename(opts.filename, ext)
          .replace(/[^\w.-]+/g, '_')
          .slice(0, 60)}${ext}`
      : `${base}${ext}`;

    const ref = path.posix.join(prefix, safeName);
    const full = this.resolveRef(ref);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return ref;
  }

  async get(ref: string): Promise<Buffer> {
    return fs.readFile(this.resolveRef(ref));
  }

  async exists(ref: string): Promise<boolean> {
    try {
      await fs.access(this.resolveRef(ref));
      return true;
    } catch {
      return false;
    }
  }

  async delete(ref: string): Promise<void> {
    try {
      await fs.unlink(this.resolveRef(ref));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  url(ref: string): string {
    return `/api/files/${ref.split('/').map(encodeURIComponent).join('/')}`;
  }

  contentTypeOf(ref: string): string {
    return contentTypeForExtension(path.extname(ref));
  }

  /** Local-only escape hatch for Puppeteer, which needs a real path or data URI. */
  absolutePath(ref: string): string {
    return this.resolveRef(ref);
  }
}
