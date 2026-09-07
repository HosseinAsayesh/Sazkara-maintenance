/**
 * Prints the Persian guide to PDF, for handing to someone who would rather receive one
 * file to open than an HTML page.
 *
 *   npm run docs:pdf
 *
 * Uses the same installed Chrome the evidence PDFs use — the reason is Persian, not
 * convenience: correct RTL output needs real bidirectional layout and Arabic-script
 * shaping, which the pure-JS PDF builders do not do.
 *
 * The guide is read from the built file over a `file://` URL, so the fonts it links from
 * Google are fetched but everything else — every screenshot — is already inline.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import puppeteer from 'puppeteer-core';

import { findChromeExecutable } from '../lib/pdf/chrome';

/** Both Persian documents print the same way; pick one with `npm run docs:pdf case`. */
const DOCUMENTS: Record<string, string> = {
  guide: 'guide-fa',
  case: 'case-fa',
};

const which = process.argv[2] ?? 'guide';
const stem = DOCUMENTS[which];
if (!stem) {
  throw new Error(`unknown document "${which}" — expected one of ${Object.keys(DOCUMENTS).join(', ')}`);
}

const SOURCE = path.join(process.cwd(), 'docs', `${stem}.html`);
const OUTPUT = path.join(process.cwd(), 'docs', `${stem}.pdf`);

async function main() {
  if (!existsSync(SOURCE)) {
    throw new Error(`${SOURCE} not found — run \`python scripts/build-guide.py\` first.`);
  }

  const browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    headless: true,
    args: ['--lang=fa-IR', '--font-render-hinting=none'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(SOURCE).href, { waitUntil: 'networkidle0', timeout: 120_000 });

    // Webfonts decide the line breaks on every page, so printing before they land would
    // paginate the document against a fallback face.
    await page.evaluate(() => document.fonts.ready);

    await page.pdf({
      path: OUTPUT,
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });

    console.log(`wrote ${path.relative(process.cwd(), OUTPUT)}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
