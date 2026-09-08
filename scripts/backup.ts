/**
 * Take a backup: a `pg_dump` of the database plus a copy of the uploads directory.
 *
 *   npm run db:backup            -> ./backups/<timestamp>/
 *   npm run db:backup -- --out D:\somewhere
 *
 * Both halves matter and neither is sufficient alone: the database holds the reports, the
 * uploads directory holds the photos and signatures those reports point at. Restoring one
 * without the other leaves forms whose evidence is missing, or files nothing references.
 *
 * `pg_dump` must be on PATH (it ships with PostgreSQL). If it is not, the database half is
 * skipped with a loud warning rather than the script pretending it succeeded.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function copyDir(from: string, to: string): number {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) count += copyDir(src, dst);
    else {
      fs.copyFileSync(src, dst);
      count++;
    }
  }
  return count;
}

/**
 * Prisma's connection string carries options pg_dump does not understand — `schema`,
 * `connection_limit`, `pgbouncer` and friends — and pg_dump rejects the whole URI rather
 * than ignoring them ("invalid URI query parameter"). That failure was silent in the
 * sense that the script carried on and reported a successful backup with only the
 * uploads in it, which is the worst way to discover a backup is half missing.
 */
function dumpUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const keep = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].includes(key)) keep.set(key, value);
    }
    url.search = keep.toString();
    return url.toString();
  } catch {
    return raw; // not a URL we can parse — hand it over untouched and let pg_dump judge
  }
}

function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Load .env before running this.');
    process.exit(1);
  }

  const root = flag('--out') ?? path.join(process.cwd(), 'backups');
  const dir = path.join(root, stamp());
  fs.mkdirSync(dir, { recursive: true });

  // --- database ---
  const dumpPath = path.join(dir, 'database.sql');
  const dump = spawnSync('pg_dump', ['--no-owner', '--no-privileges', '--file', dumpPath, dumpUrl(url)], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  if (dump.error || dump.status !== 0) {
    console.error(
      '\n! pg_dump failed or is not on PATH — the DATABASE half of this backup is MISSING.\n' +
        '  Install the PostgreSQL client tools, or dump manually, before relying on this.\n',
    );
  } else {
    const size = fs.statSync(dumpPath).size;
    console.log(`database  -> ${dumpPath}  (${(size / 1024).toFixed(0)} KB)`);
  }

  // --- uploads ---
  const uploads = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
  const copied = copyDir(uploads, path.join(dir, 'uploads'));
  console.log(`uploads   -> ${path.join(dir, 'uploads')}  (${copied} files)`);

  console.log(`\nBackup complete: ${dir}`);
  if (dump.status !== 0) process.exit(1);
}

main();
