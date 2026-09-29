/**
 * Builds the folder handed to the customer's IT: a compiled, self-contained server with
 * NO source code, the tools and config to run it, the install guides, and the source
 * code in an encrypted escrow archive.
 *
 *   npm run package:release                       -> E:\Sazkara_maintenance\handover
 *   npm run package:release -- --out D:\somewhere
 *
 * Builds from a clean export of the committed HEAD in a temp folder, never from this
 * working tree: uncommitted edits cannot leak into a release, the running demo's `.next`
 * is left alone, and Prisma can write its Linux engine without fighting the demo server
 * for a locked DLL.
 *
 * Runs on the vendor's Windows laptop. Needs git, tar (built into Windows 10+) and 7-Zip
 * (7z.exe or 7zr.exe) for the escrow archive.
 */
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const OUT = path.resolve(flag('out') ?? path.join(ROOT, '..', '..', 'handover'));
const STAGE = path.join(os.tmpdir(), 'sazkara-release');
const MARKER = '.sazkara-handover';
const LICENSE_HOME = path.join(os.homedir(), '.sazkara-license');
const LINUX_ENGINE = 'libquery_engine-debian-openssl-3.0.x.so.node';
const WIN_TAR = 'C:\\Windows\\System32\\tar.exe';
const TAR = process.platform === 'win32' && fs.existsSync(WIN_TAR) ? WIN_TAR : 'tar';

function step(message: string) {
  console.log(`\n== ${message}`);
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}): string {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (result.error || result.status !== 0) {
    fail(`${cmd} ${args.join(' ')} failed:\n${result.stderr || result.error?.message || ''}`);
  }
  return String(result.stdout ?? '').trim();
}

function walk(dir: string, visit: (file: string) => void) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, visit);
    else visit(p);
  }
}

function copy(from: string, to: string) {
  fs.cpSync(from, to, { recursive: true });
}

/** Shell scripts and unit files must reach Linux with LF endings or they will not run. */
function copyText(from: string, to: string, vars: Record<string, string> = {}) {
  let text = fs.readFileSync(from, 'utf8').replace(/\r\n/g, '\n');
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{{${k}}}`, v);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, text);
}

function find7z(): string | null {
  const candidates = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    'C:\\Program Files\\Docker\\Docker\\7zr.exe',
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) return found;
  const onPath = spawnSync('7z', ['i'], { encoding: 'utf8' });
  return onPath.status === 0 ? '7z' : null;
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---------------------------------------------------------------------------------

const version = run('git', ['describe', '--tags', '--always'], { cwd: ROOT });
const commit = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT });
const dirty = run('git', ['status', '--porcelain'], { cwd: ROOT });
const today = new Date().toISOString().slice(0, 10);

console.log(`Packaging ${version} (${commit}) -> ${OUT}`);
if (dirty) {
  console.log('\n  NOTE: you have uncommitted changes. They are NOT in this package - only');
  console.log('  what is committed is. Commit first if they should be included.');
}

if (fs.existsSync(OUT)) {
  if (!fs.existsSync(path.join(OUT, MARKER))) {
    fail(`${OUT} exists and was not made by this script. Move it away or pass --out.`);
  }
}

step('Exporting the committed source to a clean build folder');
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
const sourceTar = path.join(os.tmpdir(), `sazkara-source-${version}.tar`);
run('git', ['archive', '--format=tar', '-o', sourceTar, 'HEAD'], { cwd: ROOT });
run(TAR, ['-xf', sourceTar, '-C', STAGE]);

step('Copying dependencies (takes a minute or two)');
if (process.platform === 'win32') {
  const r = spawnSync(
    'robocopy',
    [path.join(ROOT, 'node_modules'), path.join(STAGE, 'node_modules'), '/E', '/MT:16', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XF', '*.tmp*'],
    { encoding: 'utf8' },
  );
  // robocopy: 0-7 are success codes, 8+ are failures.
  if (r.status === null || r.status >= 8) fail(`robocopy failed (${r.status}):\n${r.stdout}`);
} else {
  copy(path.join(ROOT, 'node_modules'), path.join(STAGE, 'node_modules'));
}

const node = process.execPath;
const inStage = (bin: string) => path.join(STAGE, 'node_modules', ...bin.split('/'));

step('Generating the database client for Windows + Linux');
run(node, [inStage('prisma/build/index.js'), 'generate'], { cwd: STAGE, stdio: 'inherit' });

step('Building the app');
run(node, [inStage('next/dist/bin/next'), 'build'], {
  cwd: STAGE,
  stdio: 'inherit',
  env: { ...process.env, SAZKARA_RELEASE: '1', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
});

step('Compiling the first-time setup tool');
run(
  node,
  [
    inStage('esbuild/bin/esbuild'),
    'prisma/seed.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--minify',
    // Prisma stays external: its engine must come from app/node_modules. bcryptjs is
    // bundled, because the traced copy in app/ carries only its ESM entry and a CJS
    // require of it fails.
    '--external:@prisma/client',
    '--outfile=seed.cjs',
  ],
  { cwd: STAGE },
);

step(`Assembling ${OUT}`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, MARKER), 'Generated by scripts/package-release.ts. Regenerated on every run.\n');

// --- app/: the compiled server ---
const app = path.join(OUT, 'app');
copy(path.join(STAGE, '.next', 'standalone'), app);
copy(path.join(STAGE, '.next', 'static'), path.join(app, '.next', 'static'));
copy(path.join(STAGE, 'public'), path.join(app, 'public'));

// Source maps embed the original source files verbatim — they must never ship. The file
// tracer also over-includes some raw .ts files (anything near a `process.cwd()` path);
// the server never loads them, since the compiled code lives in `.next`.
let removedMaps = 0;
let removedSources = 0;
const isSourceFile = (f: string) =>
  /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts') &&
  !path.relative(app, f).split(path.sep).includes('node_modules');
walk(app, (f) => {
  const base = path.basename(f);
  if (f.endsWith('.map') || base.startsWith('.env') || isSourceFile(f)) {
    fs.rmSync(f);
    if (f.endsWith('.map')) removedMaps++;
    else if (isSourceFile(f)) removedSources++;
  }
});
// The stray sources lived in app/lib/...; don't leave their empty folders behind.
fs.rmSync(path.join(app, 'lib'), { recursive: true, force: true });

const prismaOut = path.join(app, 'node_modules', '.prisma', 'client');
const linuxEngine = path.join(STAGE, 'node_modules', '.prisma', 'client', LINUX_ENGINE);
if (!fs.existsSync(linuxEngine)) fail(`The Linux database engine was not generated (${LINUX_ENGINE}).`);
fs.mkdirSync(prismaOut, { recursive: true });
fs.copyFileSync(linuxEngine, path.join(prismaOut, LINUX_ENGINE));
for (const f of fs.readdirSync(prismaOut)) {
  if (f.startsWith('query_engine-windows')) fs.rmSync(path.join(prismaOut, f));
}

// --- database/, tools/, config/ ---
copy(path.join(STAGE, 'prisma', 'migrations'), path.join(OUT, 'database', 'migrations'));
copyText(path.join(STAGE, 'prisma', 'schema.prisma'), path.join(OUT, 'database', 'schema.prisma'));
walk(path.join(OUT, 'database', 'migrations'), (f) => copyText(f, f));

for (const f of fs.readdirSync(path.join(STAGE, 'deploy', 'tools'))) {
  copyText(path.join(STAGE, 'deploy', 'tools', f), path.join(OUT, 'tools', f));
}
fs.copyFileSync(path.join(STAGE, 'seed.cjs'), path.join(OUT, 'tools', 'seed.cjs'));
for (const f of fs.readdirSync(path.join(STAGE, 'deploy', 'config'))) {
  copyText(path.join(STAGE, 'deploy', 'config', f), path.join(OUT, 'config', f));
}

step('Checking that no source code slipped in');
// Phrases that exist only in the source's comments; a minified build has none of them.
const CANARIES = [
  'never earlier than any moment the app has already seen',
  'Deliberately does NOT check expiry',
  'The raw client. Only the license module may use it directly',
];
const leaks: string[] = [];
walk(OUT, (f) => {
  const rel = path.relative(OUT, f);
  const inDeps = rel.split(path.sep).includes('node_modules');
  if (f.endsWith('.map')) leaks.push(`${rel} (source map)`);
  if (!inDeps && /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts')) leaks.push(`${rel} (source file)`);
  if (/\.(js|cjs|mjs|json|html|rsc|txt)$/.test(f) && fs.statSync(f).size < 20_000_000) {
    const text = fs.readFileSync(f, 'utf8');
    for (const c of CANARIES) if (text.includes(c)) leaks.push(`${rel} (contains source text)`);
  }
});
if (leaks.length) {
  fail(`Source code found in the package - NOT safe to hand over:\n    ${leaks.slice(0, 20).join('\n    ')}`);
}
console.log(
  `  clean: ${removedMaps} source maps and ${removedSources} stray source files removed; no source left.`,
);

// --- the one file to upload to the server ---
step('Creating the server upload archive');
const serverTar = `sazkara-server-${version}.tar.gz`;
run(TAR, ['-czf', serverTar, 'app', 'tools', 'config', 'database'], { cwd: OUT });

// --- escrow ---
step('Creating the encrypted source escrow');
const sevenZip = find7z();
let escrowSha = '';
const escrowName = `sazkara-source-${version}.7z`;
if (!sevenZip) {
  console.log('  SKIPPED: 7-Zip not found. Install 7-Zip and run again to include the escrow.');
} else {
  fs.mkdirSync(LICENSE_HOME, { recursive: true });
  const pwFile = path.join(LICENSE_HOME, `escrow-password-${version}.txt`);
  if (!fs.existsSync(pwFile)) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = randomBytes(32);
    const pw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    fs.writeFileSync(pwFile, `${pw}\n`, { mode: 0o600 });
  }
  const password = fs.readFileSync(pwFile, 'utf8').trim();
  const escrowDir = path.join(OUT, 'escrow');
  fs.mkdirSync(escrowDir, { recursive: true });
  const archive = path.join(escrowDir, escrowName);
  // -mhe=on also encrypts the file list, so not even the file names are readable.
  run(sevenZip, ['a', '-t7z', '-mx=9', '-mhe=on', `-p${password}`, archive, sourceTar]);
  escrowSha = sha256(archive);
  console.log(`  ${archive}`);
  console.log(`  password saved at ${pwFile}  <- keep this; do NOT put it in the handover`);
}

// --- guides ---
const vars = {
  VERSION: version,
  COMMIT: commit,
  DATE: today,
  SERVER_TAR: serverTar,
  ESCROW_FILE: escrowName,
  ESCROW_SHA256: escrowSha || '(escrow not included in this package)',
};
const docs = path.join(STAGE, 'deploy', 'docs');
for (const f of fs.readdirSync(docs)) {
  if (f.startsWith('ESCROW') && !escrowSha) continue;
  const target = f.startsWith('ESCROW') ? path.join(OUT, 'escrow', f) : path.join(OUT, f);
  copyText(path.join(docs, f), target, vars);
}
fs.writeFileSync(
  path.join(OUT, 'VERSION.txt'),
  `Sazkara Maintenance ${version}\nCommit: ${commit}\nPackaged: ${today}\n`,
);

fs.rmSync(sourceTar, { force: true });
fs.rmSync(STAGE, { recursive: true, force: true });

console.log(`\nDone. Hand over the folder:\n  ${OUT}\n`);
