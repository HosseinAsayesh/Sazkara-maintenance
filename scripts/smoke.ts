/**
 * End-to-end verification of the business rules in spec §5, §6, §8, §9, §10.
 * Run against a seeded database:  npx tsx scripts/smoke.ts
 */

import assert from 'node:assert/strict';

import ExcelJS from 'exceljs';

import bcrypt from 'bcryptjs';

import { getOverview, getPartRates, forecastParts } from '../lib/analytics';
// NB: lib/auth is deliberately not imported here — it pulls in next/navigation, which
// cannot load outside the Next runtime. Password hashing is the only piece needed.
import { nextTechnicianCode } from '../lib/codes';
import { DAY_MS, formatJalali } from '../lib/dates';
import { buildJtiWorkbook, collectJtiRows } from '../lib/exports/jti';
import { buildPartsUsageReport } from '../lib/exports/parts-usage';
import { commitHistorical, parseHistoricalDate, previewHistorical } from '../lib/historical';
import { buildReview, commitImport, extractRows, parseWorkbook } from '../lib/imports';
import { JTI_EXPORT_HEADERS, PART_CATALOG } from '../lib/parts';
import { generateEvidencePdf } from '../lib/pdf/evidence';
import { prisma } from '../lib/prisma';
import { createRepairForm, lookupUid } from '../lib/repair-forms';
import { normaliseUid } from '../lib/text';

let pass = 0;
function ok(label: string, detail = '') {
  pass++;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}
function section(name: string) {
  console.log(`\n${name}`);
}

/** 1x1 PNG, enough to stand in for a photo/signature. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function reset() {
  // Wipe transactional data but keep the seeded catalogue/cities/manager.
  await prisma.partUsage.deleteMany();
  await prisma.photo.deleteMany();
  await prisma.evidencePdfBatch.deleteMany();
  await prisma.repairForm.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.columnMappingProfile.deleteMany();
  await prisma.stand.deleteMany();
  await prisma.store.deleteMany();
  await prisma.user.deleteMany({ where: { role: 'TECHNICIAN' } });
  await prisma.counter.deleteMany({ where: { key: 'repairForm' } });
}

async function buildJtiOrderFile(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Order');
  // Deliberately NOT our export layout — this is Jti's own arbitrary shape (§5).
  sheet.addRow(['ردیف', 'کد استند', 'نام فروشگاه', 'شهر', 'آدرس', 'مدیر', 'تلفن']);
  sheet.addRow([1, 'SZ-1001', 'سوپر مارکت آفتاب', 'تهران', 'خیابان ولیعصر', 'آقای رضایی', '02112345678']);
  sheet.addRow([2, 'SZ-1002', 'سوپر مارکت آفتاب', 'تهران', 'خیابان ولیعصر', 'آقای رضایی', '02112345678']);
  sheet.addRow([3, 'sz 1003', 'هایپر ستاره', 'اصفهان', 'چهارباغ', 'خانم احمدی', '03134567890']);
  sheet.addRow([4, '', 'ردیف بدون شناسه', 'تهران', '', '', '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  console.log('Sazkara smoke test\n==================');
  await reset();

  /* ---------------------------------------------------------------- */
  section('Seed data');
  const parts = await prisma.partCatalogItem.findMany({ orderBy: { sortOrder: 'asc' } });
  assert.equal(parts.length, 30);
  assert.equal(parts[0].nameFa, 'پلکسی شلف');
  assert.equal(parts[29].nameFa, 'درب');
  ok('30-part catalogue in export order', `${parts[0].nameFa} … ${parts[29].nameFa}`);

  const tehran = await prisma.city.findFirstOrThrow({ where: { isTehran: true } });
  const isfahan = await prisma.city.findFirstOrThrow({ where: { name: 'اصفهان' } });
  ok('Tehran flagged separately from other cities', tehran.name);

  /* ---------------------------------------------------------------- */
  section('§4.1 technician approval');
  const manager = await prisma.user.findFirstOrThrow({ where: { role: 'MANAGER' } });
  const tech = await prisma.user.create({
    data: {
      name: 'علی محمدی',
      phone: '09121111111',
      passwordHash: await bcrypt.hash('secret123', 10),
      role: 'TECHNICIAN',
      status: 'PENDING',
    },
  });
  assert.equal(tech.status, 'PENDING');
  assert.equal(tech.technicianCode, null);
  ok('sign-up starts PENDING with no code');

  const code = await nextTechnicianCode();
  const approved = await prisma.user.update({
    where: { id: tech.id },
    data: { status: 'APPROVED', technicianCode: code },
  });
  ok('approval assigns a technician code', approved.technicianCode!);

  /* ---------------------------------------------------------------- */
  section('§5 Jti order import with column mapping');
  const orderFile = await buildJtiOrderFile();
  const parsed = await parseWorkbook(orderFile);
  assert.equal(parsed.sheets[0].headers[1], 'کد استند');
  ok('workbook headers detected for mapping', parsed.sheets[0].headers.join(', '));

  const mapping = {
    uid: 1,
    storeName: 2,
    cityName: 3,
    address: 4,
    managerName: 5,
    phone: 6,
  };
  const { rows, skippedNoUid } = await extractRows(orderFile, {
    sheetName: 'Order',
    headerRow: 1,
    mapping,
  });
  assert.equal(rows.length, 3);
  assert.equal(skippedNoUid, 1);
  ok('rows extracted, UID-less row reported not dropped', `${rows.length} rows, ${skippedNoUid} skipped`);

  assert.equal(rows[2].uid, 'SZ1003');
  ok('uid normalised across spacing/case', `"sz 1003" -> ${rows[2].uid}`);

  const batch = await commitImport(rows, {
    name: 'Phase 1',
    source: 'JTI_EXCEL',
    importedById: manager.id,
    mapping,
  });
  assert.equal(batch.created, 3);
  ok('order committed', `${batch.created} lines`);

  const store = await prisma.store.findFirstOrThrow({ where: { cityId: tehran.id } });
  const standsAtStore = await prisma.stand.count({ where: { storeId: store.id } });
  assert.equal(standsAtStore, 2);
  ok('§6.6 two stands share one store ("double stand")', `${store.name}: ${standsAtStore}`);

  /* ---------------------------------------------------------------- */
  section('§4.3 uid lookup pre-fill');
  const lookup = await lookupUid('sz-1001');
  assert.equal(lookup.uid, 'SZ1001');
  assert.equal(lookup.isUnmatched, false);
  assert.equal(lookup.prefill.storeName, 'سوپر مارکت آفتاب');
  ok('store metadata pre-filled from the import row', lookup.prefill.storeName);

  const strayLookup = await lookupUid('UNKNOWN-9999');
  assert.equal(strayLookup.isUnmatched, true);
  ok('uid absent from every order flagged as unmatched');

  /* ---------------------------------------------------------------- */
  section('§6.1 / §6.6 repair submission and wages');
  await prisma.wageSetting.upsert({
    where: { key: 'tehranStandRate' },
    create: { key: 'tehranStandRate', value: 150000 },
    update: { value: 150000 },
  });
  await prisma.wageSetting.upsert({
    where: { key: 'secondStandRate' },
    create: { key: 'secondStandRate', value: 90000 },
    update: { value: 90000 },
  });

  const photos = [
    { type: 'STORE' as const, fileRef: 'test/store.png' },
    { type: 'BEFORE' as const, fileRef: 'test/before.png' },
    { type: 'AFTER' as const, fileRef: 'test/after.png' },
  ];
  const sigs = {
    technicianSignature: 'test/tech.png',
    storeManagerSignature: 'test/mgr.png',
  };

  const transformer = parts.find((p) => p.nameFa === 'ترانس')!;
  const fuse = parts.find((p) => p.nameFa === 'فیوز')!;
  const spring = parts.find((p) => p.nameFa === 'فنر')!;

  // Timeline: both Tehran stands serviced in one visit 5 days ago, so the tier-1/tier-2
  // "double stand" rule is exercised on a single day.
  const visitDay = new Date(Date.now() - 5 * DAY_MS);

  const first = await createRepairForm({
    uid: 'SZ1001',
    technicianId: tech.id,
    cityId: tehran.id,
    date: visitDay,
    storeName: 'سوپر مارکت آفتاب',
    parts: [
      { partCatalogItemId: transformer.id, action: 'REPLACED', quantity: 1 },
      { partCatalogItemId: fuse.id, action: 'REPLACED', quantity: 2 },
      { partCatalogItemId: spring.id, action: 'REPAIRED', quantity: 1 },
    ],
    qualityScore: 4,
    timeSpentMinutes: 35,
    notes: 'تعویض ترانس سوخته',
    photos,
    ...sigs,
  });
  assert.equal(first.outcome, 'REPAIRED');
  assert.equal(first.wage.tier, 1);
  assert.equal(first.wage.amount, 150000);
  ok('outcome derived from parts; first stand paid the Tehran rate', `tier 1 = ${first.wage.amount}`);

  const second = await createRepairForm({
    uid: 'SZ1002',
    technicianId: tech.id,
    cityId: tehran.id,
    date: visitDay,
    storeName: 'سوپر مارکت آفتاب',
    parts: [{ partCatalogItemId: fuse.id, action: 'REPLACED', quantity: 1 }],
    qualityScore: 5,
    photos,
    ...sigs,
  });
  assert.equal(second.wage.tier, 2);
  assert.equal(second.wage.amount, 90000);
  ok('§6.6 second stand at the same store paid the reduced rate', `tier 2 = ${second.wage.amount}`);

  const notRepaired = await createRepairForm({
    uid: 'SZ1003',
    technicianId: tech.id,
    cityId: isfahan.id,
    storeName: 'هایپر ستاره',
    parts: [],
    notRepairedReason: 'STORE_TEMPORARILY_CLOSED',
    photos,
    ...sigs,
  });
  assert.equal(notRepaired.outcome, 'NOT_REPAIRED');
  assert.equal(notRepaired.wage.amount, 0);
  ok('no parts -> NOT_REPAIRED with a fixed reason', notRepaired.form.notRepairedReason!);

  await assert.rejects(
    () =>
      createRepairForm({
        uid: 'SZ1003',
        technicianId: tech.id,
        cityId: isfahan.id,
        parts: [],
        photos,
        ...sigs,
      }),
    /REASON_REQUIRED/,
  );
  ok('§6.5 a reason is mandatory when nothing was repaired');

  await assert.rejects(
    () =>
      createRepairForm({
        uid: 'SZ1001',
        technicianId: tech.id,
        parts: [{ partCatalogItemId: fuse.id, action: 'REPLACED', quantity: 1 }],
        qualityScore: 3,
        photos: [{ type: 'STORE', fileRef: 'x.png' }],
        ...sigs,
      }),
    /PHOTOS_REQUIRED/,
  );
  ok('§4.4 all three photos are enforced');

  /* ---------------------------------------------------------------- */
  section('§6.3 re-repair window');
  const reRepair = await createRepairForm({
    uid: 'SZ1001',
    technicianId: tech.id,
    cityId: tehran.id,
    parts: [{ partCatalogItemId: transformer.id, action: 'REPLACED', quantity: 1 }],
    qualityScore: 3,
    photos,
    ...sigs,
  });
  assert.equal(reRepair.isReRepair, true);
  assert.equal(reRepair.form.previousFormId, first.form.id);
  ok('repeat repair inside 14 days flagged as a re-repair');

  // A repair long after the window is a fresh repair, not a re-repair.
  const oldDate = new Date(Date.now() - 40 * DAY_MS);
  const outsideWindow = await createRepairForm({
    uid: 'SZ1002',
    technicianId: tech.id,
    cityId: tehran.id,
    date: oldDate,
    parts: [{ partCatalogItemId: spring.id, action: 'REPLACED', quantity: 1 }],
    qualityScore: 4,
    photos,
    ...sigs,
  });
  assert.equal(outsideWindow.isReRepair, false);
  ok('repair outside the 14-day window is not a re-repair');

  /* ---------------------------------------------------------------- */
  section('§6.4 duplicate detection on a later order');
  const secondOrder = await buildJtiOrderFile();
  const { rows: rows2 } = await extractRows(secondOrder, {
    sheetName: 'Order',
    headerRow: 1,
    mapping,
  });
  const review = await buildReview(rows2, 0);
  const flagged = Object.keys(review.previouslyRepaired);
  assert.ok(flagged.includes('SZ1001'));
  assert.ok(flagged.includes('SZ1002'));
  assert.ok(!flagged.includes('SZ1003')); // never successfully repaired
  ok('previously-repaired uids surfaced for a decision', flagged.join(', '));

  const batch2 = await commitImport(rows2, {
    name: 'Phase 2',
    source: 'JTI_EXCEL',
    importedById: manager.id,
    excludedUids: ['SZ1001'],
  });
  const excludedLine = await prisma.orderLine.findFirstOrThrow({
    where: { batchId: batch2.batch.id, uid: 'SZ1001' },
  });
  assert.equal(excludedLine.status, 'EXCLUDED');
  assert.equal(excludedLine.isDuplicate, true);
  ok('excluded duplicate is retained as EXCLUDED, not deleted');

  /* ---------------------------------------------------------------- */
  section('§6.7 per-uid history');
  const history = await lookupUid('SZ1001');
  assert.equal(history.history.length, 2);
  ok('stand accumulates every form ever filed against it', `${history.history.length} forms`);

  /* ---------------------------------------------------------------- */
  section('§7 / §6.3 dashboard counting');
  const overview = await getOverview({});
  // SZ1001 (first) + SZ1002 (first) + SZ1002 (old) = 3 repaired; the re-repair excluded.
  assert.equal(overview.totals.reRepairs, 1);
  assert.equal(overview.totals.repaired, 3);
  assert.equal(overview.totals.notRepaired, 1);
  ok('re-repair excluded from the repaired count', `repaired=${overview.totals.repaired}, reRepairs=${overview.totals.reRepairs}`);

  // All three repairs were in Tehran (SZ1001 today, SZ1002 today, SZ1002 40 days ago —
  // the last is a separate project, outside the re-repair window, so it counts).
  assert.equal(overview.split.tehran.repaired, 3);
  assert.equal(overview.split.otherCities.notRepaired, 1);
  ok('§7 Tehran vs other-cities split', `Tehran repaired=${overview.split.tehran.repaired}`);
  // 5 days ago: SZ1001 tier 1 (150k) + SZ1002 tier 2 (90k).
  // Today: the SZ1001 re-repair is the only stand at that store today, so tier 1 (150k).
  // 40 days ago: SZ1002 alone that day, tier 1 (150k).
  assert.equal(overview.split.tehran.wageTotal, 150000 + 90000 + 150000 + 150000);
  ok('wage totals split by city bucket', String(overview.split.tehran.wageTotal));

  /* ---------------------------------------------------------------- */
  section('§6.8 parts usage (replaced only, re-repairs included)');
  const usage = await buildPartsUsageReport({});
  const transformerRow = usage.rows.find((r) => r.nameFa === 'ترانس')!;
  const springRow = usage.rows.find((r) => r.nameFa === 'فنر')!;
  // 1 from the first repair + 1 from the re-repair.
  assert.equal(transformerRow.total, 2);
  ok('re-repair parts still count toward usage totals', `ترانس = ${transformerRow.total}`);
  // The spring was REPAIRED once (not billable) and REPLACED once.
  assert.equal(springRow.total, 1);
  ok('repaired-in-place parts excluded from consumption', `فنر = ${springRow.total}`);

  /* ---------------------------------------------------------------- */
  section('§8 Jti export format');
  const exportRows = await collectJtiRows({});
  assert.equal(exportRows.length, 4); // repaired only (3 repairs + 1 re-repair)
  const workbook = await buildJtiWorkbook(exportRows);

  const check = new ExcelJS.Workbook();
  await check.xlsx.load(workbook as unknown as ArrayBuffer);
  const sheet = check.worksheets[0];

  const headerValues: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headerValues[col - 1] = String(cell.value ?? '');
  });
  assert.equal(headerValues.length, 43);
  assert.deepEqual(headerValues, JTI_EXPORT_HEADERS);
  ok('43 columns with the exact Persian headers', `1="${headerValues[0]}" 4="${headerValues[3]}" 43="${headerValues[42]}"`);
  assert.equal(headerValues[4], 'پلکسی شلف');
  assert.equal(headerValues[33], 'درب');
  ok('columns 5–34 are the 30 parts in catalogue order');

  const firstRow = sheet.getRow(2);
  assert.equal(firstRow.getCell(1).value, 1);
  assert.match(String(firstRow.getCell(2).value), /^\d{4}\/\d{2}\/\d{2}$/);
  ok('column 2 carries a Jalali date', String(firstRow.getCell(2).value));

  // Find the SZ1001 row and check the transformer/fuse quantities land in the right columns.
  let checkedQuantities = false;
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (String(row.getCell(4).value) !== 'SZ1001') continue;
    const transformerCol = 4 + PART_CATALOG.findIndex((p) => p.nameFa === 'ترانس') + 1;
    const fuseCol = 4 + PART_CATALOG.findIndex((p) => p.nameFa === 'فیوز') + 1;
    const springCol = 4 + PART_CATALOG.findIndex((p) => p.nameFa === 'فنر') + 1;
    if (row.getCell(fuseCol).value === 2) {
      assert.equal(row.getCell(transformerCol).value, 1);
      assert.equal(row.getCell(springCol).value, 0, 'repaired-only part must export as 0');
      assert.equal(row.getCell(43).value, 4); // quality
      assert.match(String(row.getCell(37).value), /تعویض:/);
      assert.match(String(row.getCell(37).value), /تعمیر:/);
      checkedQuantities = true;
      break;
    }
  }
  assert.ok(checkedQuantities, 'expected to find the SZ1001 export row');
  ok('replaced quantities land in the right part columns; repaired-only exports 0');
  ok('column 37 describes both replaced and repaired work');

  const perCityRows = await collectJtiRows({ cityId: tehran.id });
  assert.ok(perCityRows.every((r) => r.cityName === tehran.name));
  ok('per-city export filter works', `${perCityRows.length} Tehran rows`);

  /* ---------------------------------------------------------------- */
  section('§10 analytics and forecasting');
  const rates = await getPartRates({});
  const transformerRate = rates.rows.find((r) => r.nameFa === 'ترانس')!;
  assert.ok(transformerRate.percentOfStands > 0);
  ok('% of stands needing each part', `ترانس: ${transformerRate.percentOfStands}% of ${rates.repairedStandCount} stands`);

  const forecast = await forecastParts(100, {});
  assert.ok(forecast.rows.length > 0);
  const forecastTransformer = forecast.rows.find((r) => r.nameFa === 'ترانس')!;
  assert.ok(forecastTransformer.estimatedQuantity > 0);
  ok('forecast projects the next phase', `100 stands -> ${forecastTransformer.estimatedQuantity} ترانس`);

  /* ---------------------------------------------------------------- */
  section('§7 historical import');
  assert.equal(formatJalali(parseHistoricalDate('1403/05/12')!), '1403/05/12');
  ok('Jalali date round-trips through the historical parser', '1403/05/12');

  const archive = await buildJtiWorkbook(exportRows);
  const preview = await previewHistorical(archive);
  assert.equal(preview.rows, 4);
  ok('a previous Jti export is readable as historical data', `${preview.rows} rows`);

  const beforeForms = await prisma.repairForm.count();
  const historical = await commitHistorical(archive, {
    name: 'Archive 1402',
    importedById: manager.id,
  });
  // Every row carries a form code that already exists, so all are skipped as duplicates.
  assert.equal(historical.imported, 0);
  assert.equal(historical.skipped, 4);
  assert.equal(await prisma.repairForm.count(), beforeForms);
  ok('re-importing the same archive is idempotent', `${historical.skipped} rows skipped`);

  /* ---------------------------------------------------------------- */
  section('§9 evidence PDF');
  // Give one form real image bytes so the PDF has something to embed.
  const { getStorage } = await import('../lib/storage');
  const storage = getStorage();
  const refs = await Promise.all([
    storage.put(PNG, { prefix: 'test', filename: 'store.png' }),
    storage.put(PNG, { prefix: 'test', filename: 'before.png' }),
    storage.put(PNG, { prefix: 'test', filename: 'after.png' }),
    storage.put(PNG, { prefix: 'test', filename: 'sig.png' }),
  ]);
  await prisma.photo.deleteMany({ where: { repairFormId: reRepair.form.id } });
  await prisma.photo.createMany({
    data: [
      { repairFormId: reRepair.form.id, type: 'STORE', fileRef: refs[0], index: 0 },
      { repairFormId: reRepair.form.id, type: 'BEFORE', fileRef: refs[1], index: 1 },
      { repairFormId: reRepair.form.id, type: 'AFTER', fileRef: refs[2], index: 2 },
    ],
  });
  await prisma.repairForm.update({
    where: { id: reRepair.form.id },
    data: { technicianSignature: refs[3], storeManagerSignature: refs[3] },
  });

  const pdf = await generateEvidencePdf({ cityId: tehran.id, date: new Date() });
  assert.equal(pdf.buffer.subarray(0, 4).toString('latin1'), '%PDF');
  assert.ok(pdf.buffer.length > 20_000, 'PDF should contain real rendered content');
  // Today's Tehran visits: just the SZ1001 re-repair (the pair was 5 days ago).
  assert.equal(pdf.standCount, 1);
  ok('evidence PDF rendered via Chrome', `${(pdf.buffer.length / 1024).toFixed(0)} KB, ${pdf.standCount} stands`);

  /* ---------------------------------------------------------------- */
  section('normalisation guards');
  assert.equal(normaliseUid('۱۲۳-۴۵۶'), '123456');
  ok('Persian digits and separators normalise into one uid', '۱۲۳-۴۵۶ -> 123456');

  console.log(`\n==================\n${pass} checks passed.\n`);
}

main()
  .catch((err) => {
    console.error('\n✗ FAILED\n', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
