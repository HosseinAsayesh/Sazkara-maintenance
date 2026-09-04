import 'server-only';

import puppeteer from 'puppeteer-core';

import { formatJalali, localDayKey, startOfLocalDay, endOfLocalDayExclusive } from '../dates';
import { prisma } from '../prisma';
import { getAppSettings } from '../settings';
import { getStorage } from '../storage';
import { findChromeExecutable } from './chrome';

/**
 * Evidence PDF (§9) — one file per day, per city.
 *
 * Cover page: logo slot, date, city, number of uids visited, manager's contact email.
 * Then one page per stand with the store photo, before, after, and a rendered version of
 * the digital form the technician filled in.
 */

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const REASON_LABELS: Record<string, string> = {
  MANAGER_NOT_AUTHORIZED: 'مدیر فروشگاه اجازهٔ تعمیر نداد',
  STORE_OR_STAND_REMOVED: 'فروشگاه یا استند جمع‌آوری شده بود',
  ALREADY_HEALTHY: 'استند سالم بود و نیاز به تعمیر نداشت',
  STORE_TEMPORARILY_CLOSED: 'فروشگاه موقتاً تعطیل بود',
  CONDITION_TOO_POOR: 'وضعیت استند برای تعمیر بسیار نامناسب بود',
};

/** Images must be inlined — the renderer has no authenticated session to fetch refs. */
async function dataUri(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  try {
    const storage = getStorage();
    if (!(await storage.exists(ref))) return null;
    const bytes = await storage.get(ref);
    return `data:${storage.contentTypeOf(ref)};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

function imageSlot(src: string | null, caption: string): string {
  return `
    <figure class="shot">
      ${
        src
          ? `<img src="${src}" alt="${esc(caption)}" />`
          : `<div class="shot-missing">تصویر ثبت نشده</div>`
      }
      <figcaption>${esc(caption)}</figcaption>
    </figure>`;
}

export interface EvidenceParams {
  cityId: string;
  /** Any instant inside the target Tehran-local day. */
  date: Date;
  /**
   * Restrict the pack to within-project re-repairs. Those are reviewed separately from
   * ordinary fieldwork, so they get their own document rather than being buried in the
   * day's main pack. Never cached: the EvidencePdfBatch cache is keyed on (city, day),
   * which belongs to the main pack.
   */
  onlyReRepairs?: boolean;
}

export async function collectEvidenceData({
  cityId,
  date,
  onlyReRepairs,
}: EvidenceParams) {
  const [city, settings, forms] = await Promise.all([
    prisma.city.findUnique({ where: { id: cityId } }),
    getAppSettings(),
    prisma.repairForm.findMany({
      where: {
        cityId,
        date: { gte: startOfLocalDay(date), lt: endOfLocalDayExclusive(date) },
        ...(onlyReRepairs ? { isReRepair: true } : {}),
      },
      orderBy: { formCode: 'asc' },
      include: {
        stand: { select: { standIndexAtStore: true } },
        technician: { select: { name: true, technicianCode: true, phone: true } },
        parts: { include: { part: { select: { nameFa: true } } } },
        photos: { orderBy: { index: 'asc' } },
      },
    }),
  ]);

  if (!city) throw new Error('CITY_NOT_FOUND');
  return { city, settings, forms };
}

async function renderFormPage(
  form: Awaited<ReturnType<typeof collectEvidenceData>>['forms'][number],
): Promise<string> {
  const pick = (type: string) => form.photos.find((p) => p.type === type)?.fileRef ?? null;

  const [storeImg, beforeImg, afterImg, techSig, mgrSig] = await Promise.all([
    dataUri(pick('STORE')),
    dataUri(pick('BEFORE')),
    dataUri(pick('AFTER')),
    dataUri(form.technicianSignature),
    dataUri(form.storeManagerSignature),
  ]);

  const extras = form.photos.filter((p) => p.type === 'OTHER');
  const extraImgs = (await Promise.all(extras.map((p) => dataUri(p.fileRef)))).filter(
    Boolean,
  ) as string[];

  const replaced = form.parts.filter((p) => p.action === 'REPLACED');
  const repaired = form.parts.filter((p) => p.action === 'REPAIRED');

  const partList = (
    list: typeof replaced,
    emptyLabel: string,
  ): string =>
    list.length
      ? `<ul class="parts">${list
          .map((p) => `<li>${esc(p.part.nameFa)} <span class="qty">×${p.quantity}</span></li>`)
          .join('')}</ul>`
      : `<p class="muted">${esc(emptyLabel)}</p>`;

  return `
  <section class="page">
    <header class="page-head">
      <div>
        <div class="uid">شناسه: ${esc(form.uid)}${
          form.standIndex > 1 ? ` — استند ${form.standIndex}` : ''
        }</div>
        <div class="muted">${esc(form.storeName ?? '')}</div>
      </div>
      <div class="page-head-left">
        <div class="badge ${form.outcome === 'REPAIRED' ? 'ok' : 'bad'}">
          ${form.outcome === 'REPAIRED' ? 'تعمیر شد' : 'تعمیر نشد'}
        </div>
        ${form.isReRepair ? '<div class="badge warn">تعمیر مجدد</div>' : ''}
        <div class="muted">${esc(form.formCode)}</div>
      </div>
    </header>

    <div class="shots">
      ${imageSlot(storeImg, 'تصویر فروشگاه')}
      ${imageSlot(beforeImg, 'قبل از تعمیر')}
      ${imageSlot(afterImg, 'بعد از تعمیر')}
    </div>

    <div class="form-card">
      <h3>فرم دیجیتال تعمیر</h3>
      <table class="kv">
        <tr>
          <th>تکنسین</th><td>${esc(form.technician.technicianCode ?? '—')}</td>
          <th>تاریخ</th><td>${esc(formatJalali(form.date))}</td>
        </tr>
        <tr>
          <th>تلفن تکنسین</th><td>${esc(form.technician.phone)}</td>
          <th>زمان تعمیر</th><td>${form.timeSpentMinutes ? `${esc(form.timeSpentMinutes)} دقیقه` : '—'}</td>
        </tr>
        <tr>
          <th>مدیر فروشگاه</th><td>${esc(form.storeManagerName ?? '—')}</td>
          <th>تلفن فروشگاه</th><td>${esc(form.storePhone ?? '—')}</td>
        </tr>
        <tr>
          <th>آدرس</th><td colspan="3">${esc(form.storeAddress ?? '—')}</td>
        </tr>
        <tr>
          <th>امتیاز کیفیت</th>
          <td colspan="3">${
            form.qualityScore === null || form.qualityScore === undefined
              ? '—'
              : `${esc(form.qualityScore)} / 5`
          }</td>
        </tr>
      </table>

      ${
        form.outcome === 'NOT_REPAIRED'
          ? `<div class="reason"><strong>علت عدم تعمیر:</strong> ${esc(
              REASON_LABELS[form.notRepairedReason ?? ''] ?? '—',
            )}</div>`
          : `<div class="parts-grid">
               <div><h4>قطعات تعویض‌شده</h4>${partList(replaced, 'قطعه‌ای تعویض نشد')}</div>
               <div><h4>قطعات تعمیرشده</h4>${partList(repaired, 'قطعه‌ای تعمیر نشد')}</div>
             </div>`
      }

      ${form.notes ? `<div class="notes"><strong>توضیحات:</strong> ${esc(form.notes)}</div>` : ''}

      <div class="signatures">
        <figure>
          ${techSig ? `<img src="${techSig}" alt="امضای تکنسین" />` : '<div class="sig-missing"></div>'}
          <figcaption>امضای تکنسین</figcaption>
        </figure>
        <figure>
          ${mgrSig ? `<img src="${mgrSig}" alt="امضای مدیر فروشگاه" />` : '<div class="sig-missing"></div>'}
          <figcaption>امضا / مهر مدیر فروشگاه</figcaption>
        </figure>
      </div>
    </div>

    ${
      extraImgs.length
        ? `<div class="shots extra">${extraImgs
            .map((src) => imageSlot(src, 'تصویر تکمیلی'))
            .join('')}</div>`
        : ''
    }
  </section>`;
}

export async function buildEvidenceHtml(params: EvidenceParams): Promise<{
  html: string;
  standCount: number;
  cityName: string;
}> {
  const { city, settings, forms } = await collectEvidenceData(params);
  const logo = await dataUri(settings.logoRef || null);

  const pages = await Promise.all(forms.map(renderFormPage));

  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  /* Tahoma is present on every Windows install and shapes Persian correctly; the
     others are fallbacks for macOS/Linux rendering hosts. */
  * { box-sizing: border-box; }
  body {
    font-family: Vazirmatn, Tahoma, "Segoe UI", "Noto Naskh Arabic", sans-serif;
    margin: 0; color: #17202a; font-size: 11px;
  }
  .page {
    padding: 14mm 12mm; page-break-after: always; min-height: 297mm;
  }
  .page:last-child { page-break-after: auto; }

  /* --- cover --- */
  .cover { display: flex; flex-direction: column; justify-content: center; align-items: center;
           text-align: center; gap: 10mm; }
  .logo-slot {
    width: 62mm; height: 30mm; border: 1.5px dashed #b8c4d4; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    color: #93a1b5; font-size: 12px;
  }
  .logo-slot img { max-width: 100%; max-height: 100%; }
  .cover h1 { font-size: 26px; margin: 0; }
  .cover .sub { font-size: 15px; color: #4a5a70; }
  .cover-stats { display: flex; gap: 8mm; margin-top: 4mm; }
  .stat { border: 1px solid #dde4ee; border-radius: 8px; padding: 5mm 8mm; min-width: 38mm; }
  .stat .n { font-size: 22px; font-weight: 700; }
  .stat .l { font-size: 11px; color: #64748b; margin-top: 2mm; }
  .contact { margin-top: 8mm; font-size: 12px; color: #4a5a70; }
  .contact a { color: #1d4ed8; text-decoration: none; }

  /* --- per-stand page --- */
  .page-head { display: flex; justify-content: space-between; align-items: flex-start;
               border-bottom: 2px solid #1f3a5f; padding-bottom: 3mm; margin-bottom: 5mm; }
  .page-head-left { text-align: left; display: flex; flex-direction: column; align-items: flex-end; gap: 1.5mm; }
  .uid { font-size: 16px; font-weight: 700; }
  .muted { color: #64748b; font-size: 11px; }
  .badge { display: inline-block; padding: 1mm 3mm; border-radius: 999px; font-size: 10px; font-weight: 700; }
  .badge.ok { background: #dcfce7; color: #166534; }
  .badge.bad { background: #fee2e2; color: #991b1b; }
  .badge.warn { background: #fef3c7; color: #92400e; }

  .shots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; margin-bottom: 5mm; }
  .shots.extra { grid-template-columns: repeat(4, 1fr); margin-top: 4mm; }
  .shot { margin: 0; }
  .shot img { width: 100%; height: 48mm; object-fit: cover; border-radius: 5px; border: 1px solid #dde4ee; }
  .shot-missing { width: 100%; height: 48mm; border: 1px dashed #cbd5e1; border-radius: 5px;
                  display: flex; align-items: center; justify-content: center; color: #94a3b8; }
  .shot figcaption { text-align: center; margin-top: 1.5mm; font-size: 10px; color: #64748b; }

  .form-card { border: 1px solid #dde4ee; border-radius: 8px; padding: 5mm; }
  .form-card h3 { margin: 0 0 3mm; font-size: 13px; color: #1f3a5f; }
  .form-card h4 { margin: 0 0 2mm; font-size: 11px; color: #1f3a5f; }
  table.kv { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
  table.kv th, table.kv td { border: 1px solid #e6ebf3; padding: 2mm 2.5mm; text-align: right; font-size: 10.5px; }
  table.kv th { background: #f5f8fc; font-weight: 600; color: #475569; width: 22mm; }

  .parts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
  ul.parts { margin: 0; padding-right: 5mm; }
  ul.parts li { margin-bottom: 1mm; }
  .qty { color: #64748b; }
  .reason { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; padding: 3mm; }
  .notes { margin-top: 3mm; background: #f8fafc; border-radius: 6px; padding: 3mm; }

  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin-top: 5mm; }
  .signatures figure { margin: 0; text-align: center; }
  .signatures img, .sig-missing {
    width: 100%; height: 22mm; object-fit: contain;
    border: 1px solid #dde4ee; border-radius: 5px; background: #fff;
  }
  .signatures figcaption { font-size: 10px; color: #64748b; margin-top: 1.5mm; }
</style>
</head>
<body>
  <section class="page cover">
    <div class="logo-slot">${
      logo ? `<img src="${logo}" alt="لوگو" />` : 'جایگاه لوگوی سازکارا'
    }</div>
    <div>
      <h1>${esc(settings.companyName || 'سازکارا')}</h1>
      <div class="sub">گزارش تصویری تعمیر استندها</div>
    </div>
    <div class="cover-stats">
      <div class="stat"><div class="n">${esc(formatJalali(params.date))}</div><div class="l">تاریخ</div></div>
      <div class="stat"><div class="n">${esc(city.name)}</div><div class="l">شهر</div></div>
      <div class="stat"><div class="n">${forms.length}</div><div class="l">استند بازدیدشده</div></div>
    </div>
    ${
      settings.managerContactEmail
        ? `<div class="contact">تماس با مدیر تعمیرات: <a href="mailto:${esc(
            settings.managerContactEmail,
          )}">${esc(settings.managerContactEmail)}</a></div>`
        : ''
    }
  </section>
  ${pages.join('\n')}
</body>
</html>`;

  return { html, standCount: forms.length, cityName: city.name };
}

export async function generateEvidencePdf(params: EvidenceParams): Promise<{
  buffer: Buffer;
  standCount: number;
  cityName: string;
}> {
  const { html, standCount, cityName } = await buildEvidenceHtml(params);

  const browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });

  try {
    const page = await browser.newPage();
    // `networkidle0` would hang: every image is already an inline data URI.
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return { buffer: Buffer.from(pdf), standCount, cityName };
  } finally {
    await browser.close();
  }
}

/**
 * Generate and cache. `EvidencePdfBatch` is keyed on (city, day) so re-downloading a
 * previously generated day is a file read rather than a fresh Chrome launch.
 */
export async function generateAndStoreEvidencePdf(
  params: EvidenceParams & { generatedById: string; force?: boolean },
) {
  const dayStart = startOfLocalDay(params.date);
  const existing = await prisma.evidencePdfBatch.findUnique({
    where: { cityId_date: { cityId: params.cityId, date: dayStart } },
  });

  if (existing && !params.force) return existing;

  const { buffer, standCount, cityName } = await generateEvidencePdf(params);

  const storage = getStorage();
  const fileRef = await storage.put(buffer, {
    // Storage path stays Gregorian so day folders sort naturally on disk; the visible
    // file name carries the Shamsi date, which is the one the manager recognises.
    prefix: `evidence/${localDayKey(params.date)}`,
    filename: `${cityName}-${formatJalali(params.date).replace(/\//g, '-')}.pdf`,
  });

  if (existing) {
    await storage.delete(existing.fileRef).catch(() => {});
    return prisma.evidencePdfBatch.update({
      where: { id: existing.id },
      data: { fileRef, standCount, generatedAt: new Date(), generatedById: params.generatedById },
    });
  }

  return prisma.evidencePdfBatch.create({
    data: {
      cityId: params.cityId,
      date: dayStart,
      fileRef,
      standCount,
      generatedById: params.generatedById,
    },
  });
}
