import 'server-only';

import { existsSync } from 'node:fs';

/**
 * Evidence PDFs are rendered by driving an already-installed Chrome (or Edge) with
 * puppeteer-core, rather than bundling Chromium.
 *
 * The reason is Persian, not size: correct RTL output needs real bidirectional text
 * layout and Arabic-script contextual glyph shaping. Chrome's text engine does both;
 * the pure-JS PDF builders generally do neither, and produce disconnected,
 * reversed-looking Persian. Rendering HTML in a real browser also means the PDF and the
 * on-screen form stay visually in sync for free.
 */

const CANDIDATE_PATHS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

let resolved: string | null | undefined;

export function findChromeExecutable(): string {
  if (resolved === undefined) {
    resolved = CANDIDATE_PATHS.find((p) => p && existsSync(p)) ?? null;
  }
  if (!resolved) {
    throw new Error(
      'No Chrome or Edge installation found for PDF rendering. Set CHROME_PATH in .env ' +
        'to the full path of a Chrome/Edge executable.',
    );
  }
  return resolved;
}
