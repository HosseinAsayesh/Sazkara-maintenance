/**
 * Captures the screenshots used by the Persian user guide.
 *
 * It drives the real application through a real browser rather than mocking anything, so
 * a screenshot can never show a screen the app cannot actually produce. Chrome comes from
 * the same resolver the evidence PDFs use, so there is nothing extra to install.
 *
 * The technician screens need a technician, and the guide documents signing up and being
 * approved anyway — so the script performs that whole flow through the UI rather than
 * writing to the database: it registers the account, approves it as the manager (which is
 * also when the technician code is issued), then signs in as the technician. Re-running is
 * safe; each step checks whether it has already been done.
 *
 *   npm run docs:shots
 *
 * Two things it deliberately does NOT do: submit a repair report, and touch any existing
 * account. Building documentation must not create fieldwork or disturb real users.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import puppeteer, { type Browser, type BrowserContext, type Page } from 'puppeteer-core';

import { findChromeExecutable } from '../lib/pdf/chrome';

const BASE = process.env.DOCS_BASE_URL ?? 'http://localhost:3000';
const OUT = path.join(process.cwd(), 'docs', 'images');

const MANAGER = {
  phone: process.env.SEED_MANAGER_PHONE ?? '09120000000',
  password: process.env.SEED_MANAGER_PASSWORD ?? 'manager1234',
};

/** Created by this script if missing, and named in the guide as the demo technician. */
const TECHNICIAN = {
  phone: '09123334455',
  password: 'tech12345',
  name: 'تکنسین نمونه',
};

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 };
const PHONE = { width: 414, height: 896, deviceScaleFactor: 2 };

async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) as `${string}.png`, fullPage });
  console.log('  ✓', `${name}.png`, fullPage ? '(full page)' : '');
}

/**
 * Navigates and lets the page settle.
 *
 * Deliberately not `networkidle2`: against `next dev` the hot-reload socket keeps a
 * connection open forever, so the network is never idle and every navigation times out.
 * Waiting for the document and then giving the streamed content a moment is reliable and
 * fast enough, since Next streams the shell first and fills it in.
 */
async function go(page: Page, url: string) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('main, form', { timeout: 60_000 }).catch(() => null);
  await new Promise((r) => setTimeout(r, 1200));
}

const settle = (page: Page) =>
  page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(() => null);

/** Each role gets its own context; one shared cookie jar would sign them over each other. */
async function newPage(context: BrowserContext, viewport = DESKTOP) {
  const page = await context.newPage();
  await page.setViewport(viewport);
  return page;
}

async function signIn(page: Page, phone: string, password: string) {
  await go(page, '/fa/login');
  if (!(await page.$('input[name="phone"]'))) return; // already signed in
  await page.type('input[name="phone"]', phone);
  await page.type('input[name="password"]', password);
  await Promise.all([settle(page), page.click('button[type="submit"]')]);
}

async function captureSignedOut(context: BrowserContext) {
  console.log('signed out');
  const page = await newPage(context);

  await go(page, '/fa/login');
  await shot(page, 'login');

  await go(page, '/fa/register');
  await shot(page, 'register');

  await page.setViewport(PHONE);
  await go(page, '/fa/login');
  await shot(page, 'login-phone');

  await page.close();
}

async function registerTechnician(context: BrowserContext) {
  console.log('technician sign-up');
  const page = await newPage(context);

  await go(page, '/fa/register');
  await page.type('input[name="name"]', TECHNICIAN.name);
  await page.type('input[name="phone"]', TECHNICIAN.phone);
  await page.type('input[name="password"]', TECHNICIAN.password);
  await page.type('input[name="passwordConfirm"]', TECHNICIAN.password);
  await Promise.all([settle(page), page.click('button[type="submit"]')]);

  if (page.url().includes('/pending')) {
    console.log('   registered — awaiting approval');
    await shot(page, 'register-pending');
  } else {
    // Do not shrug this off as "already exists": if registration actually failed, every
    // technician screenshot below silently becomes a photograph of the login page.
    const message = await page.evaluate(
      () => document.querySelector('[class*="text-red"], [role="alert"]')?.textContent?.trim() ?? '',
    );
    console.log(`   not registered — the form stayed put${message ? `: ${message}` : ''}`);
    console.log('     (expected if the account already exists)');
  }

  await page.close();
}

/** Approves the demo technician through the manager UI, which is what issues its code. */
async function approveTechnician(page: Page) {
  await go(page, '/fa/manager/technicians');
  await shot(page, 'manager-technicians');

  const approved = await page.evaluate((phone: string) => {
    // Find the row for this phone, then the APPROVE button inside it.
    const row = [...document.querySelectorAll('tr, li, div')].find(
      (el) =>
        el.textContent?.includes(phone) &&
        el.querySelector('button[name="decision"][value="APPROVE"]'),
    );
    const button = row?.querySelector<HTMLButtonElement>(
      'button[name="decision"][value="APPROVE"]',
    );
    if (!button) return false;
    button.click();
    return true;
  }, TECHNICIAN.phone);

  if (approved) {
    await new Promise((r) => setTimeout(r, 2500));
    console.log('   approved the demo technician');
    await go(page, '/fa/manager/technicians');
    await shot(page, 'manager-approve-technician');
    return;
  }

  // Distinguish "nothing to do" from "could not find the control", because only one of
  // those is fine.
  const state = await page.evaluate((phone: string) => {
    const onPage = document.body.textContent?.includes(phone) ?? false;
    return onPage ? 'already approved' : 'NOT LISTED — sign-up never completed';
  }, TECHNICIAN.phone);
  console.log(`   ${state}`);
}

async function captureManager(context: BrowserContext) {
  console.log('manager');
  const page = await newPage(context);
  await signIn(page, MANAGER.phone, MANAGER.password);

  await approveTechnician(page);

  // The dashboard and analytics are the two that carry meaning below the fold.
  for (const [name, url, whole] of [
    ['manager-dashboard', '/fa/manager', true],
    ['manager-projects', '/fa/manager/projects', false],
    ['manager-imports', '/fa/manager/imports', false],
    ['manager-uids', '/fa/manager/uids', false],
    ['manager-exports', '/fa/manager/exports', false],
    ['manager-analytics', '/fa/manager/analytics', true],
    ['manager-parts', '/fa/manager/parts', false],
    ['manager-settings', '/fa/manager/settings', false],
  ] as const) {
    await go(page, url);
    await shot(page, name, whole);
  }

  await page.close();
}

async function captureTechnician(context: BrowserContext, uid: string | null) {
  console.log('technician');
  const page = await newPage(context, PHONE);
  await signIn(page, TECHNICIAN.phone, TECHNICIAN.password);

  if (page.url().includes('/pending')) {
    console.log('  ! still pending — skipping the technician screens');
    await page.close();
    return;
  }

  await go(page, '/fa/technician');
  await shot(page, 'technician-home');

  if (!uid) {
    console.log('  ! no uid in the order book — skipping the form');
    await page.close();
    return;
  }

  await go(page, `/fa/technician/stand/${uid}`);
  await shot(page, 'technician-form', true);

  // A second stand turns the strip into real tabs, which is what the guide explains.
  const added = await page.evaluate(() => {
    const add = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.trim().startsWith('+'),
    );
    if (!add) return false;
    add.click();
    return true;
  });
  if (added) {
    await new Promise((r) => setTimeout(r, 600));
    await shot(page, 'technician-stand-tabs', true);
  }

  await page.close();
}

/**
 * A uid to photograph the form with. The technician home is a search box, not a list, so
 * there is nothing on screen to read one from — and hard-coding one would break on any
 * database but this laptop's. Read-only.
 */
async function pickUid(): Promise<string | null> {
  const db = new PrismaClient();
  try {
    const line =
      (await db.orderLine.findFirst({ where: { status: 'PENDING' }, select: { uid: true } })) ??
      (await db.orderLine.findFirst({ select: { uid: true } }));
    return line?.uid ?? null;
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`capturing from ${BASE} into docs/images\n`);

  const uid = await pickUid();

  const browser: Browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    headless: true,
    args: ['--lang=fa-IR', '--font-render-hinting=none'],
  });

  try {
    const anon = await browser.createBrowserContext();
    await captureSignedOut(anon);
    await registerTechnician(anon);
    await anon.close();

    const manager = await browser.createBrowserContext();
    await captureManager(manager);
    await manager.close();

    const technician = await browser.createBrowserContext();
    await captureTechnician(technician, uid);
    await technician.close();
  } finally {
    await browser.close();
  }

  console.log('\ndone');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
