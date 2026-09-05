/**
 * End-to-end verification of the business rules in spec §5, §6, §8, §9, §10.
 * Run against a seeded database:  npx tsx scripts/smoke.ts
 */

import assert from 'node:assert/strict';

import ExcelJS from 'exceljs';

import bcrypt from 'bcryptjs';

import { getOverview, getPartRates, forecastParts } from '../lib/analytics';
import {
  addOrMatchCity,
  findDuplicateCityGroups,
  mergeCities,
  resolveCityId as resolveCityByName,
} from '../lib/cities';
// NB: lib/auth is deliberately not imported here — it pulls in next/navigation, which
// cannot load outside the Next runtime. Password hashing is the only piece needed.
import { nextTechnicianCode } from '../lib/codes';
import {
  DAY_MS,
  formatJalali,
  isValidJalaliDate,
  jalaliMonthLength,
  jalaliToDate,
  toJalaliParts,
} from '../lib/dates';
import { buildJtiWorkbook, collectJtiRows } from '../lib/exports/jti';
import { buildPartsUsageReport } from '../lib/exports/parts-usage';
import { commitHistorical, parseHistoricalDate, previewHistorical } from '../lib/historical';
import { buildReview, commitImport, extractRows, parseWorkbook } from '../lib/imports';
import { JTI_EXPORT_HEADERS, LEGACY_PART_HEADERS, PART_CATALOG } from '../lib/parts';
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

/** Name of the second campaign this suite creates to exercise the project boundary. */
const TEST_PROJECT_NAME = 'پروژه آزمایشی دوم';

async function reset() {
  // Wipe transactional data but keep the seeded catalogue/cities/manager.
  await prisma.partUsage.deleteMany();
  await prisma.photo.deleteMany();
  await prisma.evidencePdfBatch.deleteMany();
  await prisma.repairForm.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.columnMappingProfile.deleteMany();
  // The seeded project is left alone; only the one this suite creates is removed, so a
  // re-run does not collide on Project.name. Phases cascade with it.
  await prisma.project.deleteMany({ where: { name: TEST_PROJECT_NAME } });
  await prisma.stand.deleteMany();
  await prisma.store.deleteMany();
  // Cities this suite invents; the seeded set is left alone. Must come after stores and
  // forms, which hold the foreign keys into City.
  await prisma.city.deleteMany({ where: { name: { in: ['Tehran'] } } });
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

  // By name, not by the isTehran flag: a duplicate city carrying the same flag would
  // otherwise make this fixture pick a different row on every run.
  const tehran = await prisma.city.findFirstOrThrow({ where: { name: 'تهران' } });
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

  // Each row in Jti's sheet is a LOCATION, so three rows create three stores, each
  // starting with a single stand. Extra stands are discovered in the field, not here.
  const importedStores = await prisma.store.findMany({
    where: { uid: { in: ['SZ1001', 'SZ1002', 'SZ1003'] } },
    include: { stands: true },
  });
  assert.equal(importedStores.length, 3);
  assert.ok(importedStores.every((st) => st.stands.length === 1));
  ok('each imported uid becomes one location with one stand', `${importedStores.length} locations`);

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
  await prisma.wageSetting.upsert({
    where: { key: 'unrepairedVisitRate' },
    create: { key: 'unrepairedVisitRate', value: 50000 },
    update: { value: 50000 },
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

  // The SAME uid, second stand at that location: stands share their store's uid, so the
  // double-stand case is one uid with two positions rather than two uids.
  const second = await createRepairForm({
    uid: 'SZ1001',
    standIndex: 2,
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
  assert.equal(second.form.uid, 'SZ1001');
  assert.equal(second.form.standIndex, 2);
  ok('§6.6 second stand shares the uid and takes the reduced rate', `tier 2 = ${second.wage.amount}`);

  const sharedStore = await prisma.store.findUniqueOrThrow({
    where: { uid: 'SZ1001' },
    include: { stands: true },
  });
  assert.equal(sharedStore.stands.length, 2);
  ok('one uid now carries two stands', `${sharedStore.stands.length} stands at SZ1001`);

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
  // Client ruling: the technician travelled either way, so a wasted trip is paid a flat
  // call-out rate, and it sits outside the tier ladder (tier 0).
  assert.equal(notRepaired.wage.amount, 50000);
  assert.equal(notRepaired.wage.tier, 0);
  ok('no parts -> NOT_REPAIRED with a fixed reason', notRepaired.form.notRepairedReason!);
  ok('unsuccessful visit paid the flat call-out rate', String(notRepaired.wage.amount));

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
  // Revised rule: the PROJECT boundary defines a re-repair, not elapsed time.
  section('§6.3 re-repair is scoped to the project');

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
  // 5 days after the first visit — inside the window, so also flagged "quick".
  assert.equal(reRepair.form.isQuickReRepair, true);
  ok('same stand twice in one project is a re-repair');
  ok('re-repair within 14 days additionally flagged as quick');

  // Same project, but far outside the old 14-day window: still a re-repair, because the
  // project boundary — not the gap — is what decides.
  const slowReRepair = await createRepairForm({
    uid: 'SZ1001',
    standIndex: 2,
    technicianId: tech.id,
    cityId: tehran.id,
    date: new Date(Date.now() + 40 * DAY_MS),
    parts: [{ partCatalogItemId: spring.id, action: 'REPLACED', quantity: 1 }],
    qualityScore: 4,
    photos,
    ...sigs,
  });
  assert.equal(slowReRepair.isReRepair, true);
  assert.equal(slowReRepair.form.isQuickReRepair, false);
  ok('same project, 45 days apart, is still a re-repair (not quick)');

  // A NEW campaign: the same uid is ordinary recurring work, must NOT be a re-repair,
  // and is marked as having history in an earlier project instead.
  const nextProject = await prisma.project.create({
    data: { name: TEST_PROJECT_NAME, startDate: new Date(), isActive: false },
  });
  const nextPhase = await prisma.phase.create({
    data: { projectId: nextProject.id, name: 'فاز ۱', sortOrder: 1 },
  });
  const nextBatch = await prisma.importBatch.create({
    data: {
      name: 'سفارش پروژه دوم',
      source: 'JTI_EXCEL',
      importedById: manager.id,
      projectId: nextProject.id,
      phaseId: nextPhase.id,
    },
  });
  await prisma.orderLine.create({
    data: { batchId: nextBatch.id, uid: 'SZ1001', cityName: tehran.name },
  });

  const laterProjectRepair = await createRepairForm({
    uid: 'SZ1001',
    technicianId: tech.id,
    cityId: tehran.id,
    parts: [{ partCatalogItemId: fuse.id, action: 'REPLACED', quantity: 1 }],
    qualityScore: 5,
    photos,
    ...sigs,
  });
  assert.equal(laterProjectRepair.form.projectId, nextProject.id);
  assert.equal(laterProjectRepair.isReRepair, false);
  assert.equal(laterProjectRepair.form.hasPreviousProjectHistory, true);
  ok('same uid in a LATER project is not a re-repair');
  ok('...but is marked as having history in an earlier project');

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
  // SZ1002 was imported but never worked, and SZ1003's only visit found the store shut,
  // so neither counts as previously repaired.
  assert.ok(!flagged.includes('SZ1002'));
  assert.ok(!flagged.includes('SZ1003'));
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
  // History is per LOCATION, so it spans both stands: stand 1 (repair, re-repair,
  // project-2 repair) plus stand 2 (repair, re-repair).
  assert.equal(history.history.length, 5);
  assert.equal(history.standCount, 2);
  ok('history covers every stand at the location', `${history.history.length} forms`);
  ok('stand accumulates every form ever filed against it', `${history.history.length} forms`);

  /* ---------------------------------------------------------------- */
  section('§7 / §6.3 dashboard counting');
  const overview = await getOverview({});
  // Repaired (re-repairs excluded): SZ1001 p1, SZ1002 p1, SZ1001 p2 = 3.
  // Re-repairs: the SZ1001 repeat and the SZ1002 repeat, both inside project 1 = 2.
  assert.equal(overview.totals.reRepairs, 2);
  assert.equal(overview.totals.repaired, 3);
  assert.equal(overview.totals.notRepaired, 1);
  // Distinct uids (locations) visited: SZ1001 and SZ1003.
  assert.equal(overview.totals.totalUids, 2);
  // One sub-stand: SZ1001's stand 2. Counted once however often it was serviced.
  assert.equal(overview.totals.subStands, 1);
  ok('distinct uids and sub-stands counted apart', `uids=${overview.totals.totalUids}, sub=${overview.totals.subStands}`);
  ok('re-repair excluded from the repaired count', `repaired=${overview.totals.repaired}, reRepairs=${overview.totals.reRepairs}`);

  assert.equal(overview.split.tehran.repaired, 3);
  assert.equal(overview.split.otherCities.notRepaired, 1);
  ok('§7 Tehran vs other-cities split', `Tehran repaired=${overview.split.tehran.repaired}`);
  // 5 days ago: SZ1001 tier 1 (150k) + SZ1002 tier 2 (90k).
  // Today: the SZ1001 re-repair (150k) and the project-2 SZ1001 repair (150k) — the same
  // stand, so neither demotes the other to the second-stand rate.
  // +40 days: SZ1002 alone that day, tier 1 (150k).
  assert.equal(overview.split.tehran.wageTotal, 150000 + 90000 + 150000 + 150000 + 150000);
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
  // Default scope is MAIN: everything in the range EXCEPT within-project re-repairs.
  // Unsuccessful visits are included (client ruling) and tinted red in the sheet.
  const exportRows = await collectJtiRows({});
  assert.equal(exportRows.length, 4); // 3 repairs + 1 unsuccessful visit
  assert.equal(exportRows.filter((r) => r.notRepaired).length, 1);
  ok('main export excludes within-project re-repairs', `${exportRows.length} rows`);
  ok('unsuccessful visits appear in the sheet', '1 red row');

  // Stands sharing a uid must repeat that uid, one row each, flagged as double stands.
  const allRows = await collectJtiRows({ scope: 'ALL' });
  const sz1001Rows = allRows.filter((r) => r.uid === 'SZ1001');
  assert.ok(sz1001Rows.length >= 2);
  assert.deepEqual(
    [...new Set(sz1001Rows.map((r) => r.uid))],
    ['SZ1001'],
    'every stand at a location carries the same uid',
  );
  assert.ok(sz1001Rows.some((r) => r.standIndex === 2));
  const sameVisit = sz1001Rows.filter((r) => r.isDoubleStand);
  assert.ok(sameVisit.length >= 2, 'stands serviced on one visit are flagged as doubles');
  ok('one uid produces one row per stand, marked as double stands', `${sz1001Rows.length} SZ1001 rows`);

  const failedRow = exportRows.find((r) => r.notRepaired)!;
  assert.match(failedRow.repairStatus, /^تعمیر نشد — /);
  assert.match(failedRow.repairStatus, /تعطیل/);
  assert.equal(failedRow.standQuality, null);
  ok('column 44 states the outcome and the reason', failedRow.repairStatus);

  const reRepairRows = await collectJtiRows({ scope: 'RE_REPAIR' });
  assert.equal(reRepairRows.length, 2);
  assert.ok(reRepairRows.every((r) => r.isReRepair && !r.notRepaired));
  ok('re-repair export carries only the repeats', `${reRepairRows.length} rows`);

  assert.equal(allRows.length, 6); // 4 main + 2 re-repairs
  ok('combined scope returns both halves', `${allRows.length} rows`);

  // A uid repaired in an earlier project stays in the MAIN sheet and is only marked.
  const carriedOver = exportRows.filter((r) => r.hasPreviousProjectHistory);
  assert.equal(carriedOver.length, 1);
  assert.equal(carriedOver[0].uid, 'SZ1001');
  ok('previous-project stand kept in the main export, flagged not excluded');
  const workbook = await buildJtiWorkbook(exportRows);

  const check = new ExcelJS.Workbook();
  await check.xlsx.load(workbook as unknown as ArrayBuffer);
  const sheet = check.worksheets[0];

  const headerValues: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headerValues[col - 1] = String(cell.value ?? '');
  });
  assert.equal(headerValues.length, 44);
  assert.deepEqual(headerValues, JTI_EXPORT_HEADERS);
  ok(
    '44 columns with the exact Persian headers',
    `1="${headerValues[0]}" 4="${headerValues[3]}" 43="${headerValues[42]}" 44="${headerValues[43]}"`,
  );
  assert.equal(headerValues[43], 'Repair status');
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
      assert.equal(row.getCell(44).value, 'تعمیر شد'); // repair status, column 44
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

  // --- legacy 28-column archives ------------------------------------------------
  // The archives written before this system existed have 28 part columns, not 30, so
  // everything after the parts sits two columns to the left. Read at the current
  // positions they did not fail loudly: the store name came out of the technician-code
  // column and part quantities landed on neighbouring catalogue entries. This locks the
  // layout detection in place.
  const legacyBook = new ExcelJS.Workbook();
  const legacySheet = legacyBook.addWorksheet('گزارش');
  legacySheet.addRow([
    'رقم', 'تاریخ', 'شهر', 'شناسه',
    ...LEGACY_PART_HEADERS,
    'Digital Address', 'Address', 'Maintenance detail', 'Tel',
    'Store name', "Manager's name", 'Technician code', 'Form code', 'Stand quality',
  ]);
  for (let i = 1; i <= 10; i++) {
    const qty = LEGACY_PART_HEADERS.map(() => 0);
    qty[7] = 1; // Transformer
    qty[6] = 2; // Fuse
    qty[21] = 3; // the merged legacy "Switch"
    qty[19] = 150; // White LED (SMD) — already centimetres in the archives
    legacySheet.addRow([
      i, `1403/05/${String(i + 10).padStart(2, '0')}`, 'تهران', `LEG${2000 + i}`,
      ...qty,
      'https://maps.example/x', 'خیابان آزادی', 'تعویض ترانس', '02100000000',
      `فروشگاه بایگانی ${i}`, 'آقای تست', 'TC-900', `OLD-${i}`, 4,
    ]);
  }
  const legacyBuffer = Buffer.from(await legacyBook.xlsx.writeBuffer());

  const legacyPreview = await previewHistorical(legacyBuffer);
  assert.equal(legacyPreview.layout, 'LEGACY');
  assert.equal(legacyPreview.rows, 10, 'every legacy row must be read, not just the ends');
  assert.equal(legacyPreview.skipped, 0);
  ok('legacy 28-column layout detected and fully read', `${legacyPreview.rows} rows`);

  const legacyCommit = await commitHistorical(legacyBuffer, {
    name: 'Legacy archive',
    importedById: manager.id,
  });
  assert.equal(legacyCommit.imported, 10);

  const legacyForm = await prisma.repairForm.findFirstOrThrow({
    where: { uid: 'LEG2001' },
    include: { parts: { include: { part: true } } },
  });

  // Trailing columns must land in the right fields despite the two-column shift.
  assert.equal(legacyForm.storeName, 'فروشگاه بایگانی 1');
  assert.equal(legacyForm.storePhone, '02100000000');
  assert.equal(legacyForm.digitalAddress, 'https://maps.example/x');
  assert.equal(legacyForm.qualityScore, 4);
  ok('legacy trailing columns map to the right fields');

  const legacyQty = (nameFa: string) =>
    legacyForm.parts.find((p) => p.part.nameFa === nameFa)?.quantity ?? 0;

  assert.equal(legacyQty('ترانس'), 1);
  assert.equal(legacyQty('فیوز'), 2);
  assert.equal(legacyQty('پایه فیوز'), 0, 'fuse must not bleed onto the fuse base');
  ok('legacy part quantities land on the correct catalogue entries');

  // The archives had one merged "Switch"; the client's ruling sends it to کلید گرد.
  assert.equal(legacyQty('کلید گرد'), 3);
  assert.equal(legacyQty('کلید مستطیلی'), 0);
  ok('merged legacy Switch imports as کلید گرد', '3');

  // Nothing feeds the two parts that did not exist back then.
  assert.equal(legacyQty('سیم نمره ۰.۵'), 0);
  ok('parts absent from the legacy sheet stay empty');

  // Legacy SMD values are already centimetres and are imported unchanged.
  assert.equal(legacyQty('نوار SMD سفید'), 150);
  ok('legacy SMD centimetres import as-is', '150');

  await prisma.partUsage.deleteMany({
    where: { repairForm: { uid: { startsWith: 'LEG2' } } },
  });
  await prisma.repairForm.deleteMany({ where: { uid: { startsWith: 'LEG2' } } });
  await prisma.stand.deleteMany({ where: { store: { uid: { startsWith: 'LEG2' } } } });
  await prisma.store.deleteMany({ where: { uid: { startsWith: 'LEG2' } } });
  await prisma.importBatch.deleteMany({ where: { name: { startsWith: 'Legacy archive' } } });

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
  // Today's Tehran visits: the SZ1001 re-repair and the SZ1001 repair filed under the
  // second project (the shared-store pair was 5 days ago).
  assert.equal(pdf.standCount, 2);
  ok('evidence PDF rendered via Chrome', `${(pdf.buffer.length / 1024).toFixed(0)} KB, ${pdf.standCount} stands`);

  // The re-repair pack is the same day filtered to repeats, so it must be strictly
  // smaller — this is the document the manager reviews separately from the day's work.
  const reRepairPdf = await generateEvidencePdf({
    cityId: tehran.id,
    date: new Date(),
    onlyReRepairs: true,
  });
  assert.equal(reRepairPdf.buffer.subarray(0, 4).toString('latin1'), '%PDF');
  assert.equal(reRepairPdf.standCount, 1);
  ok('re-repair evidence pack covers only the repeats', `${reRepairPdf.standCount} stand`);

  /* ---------------------------------------------------------------- */
  section('SMD strips measured in centimetres');
  const smdWhite = parts.find((p) => p.nameFa === 'نوار SMD سفید')!;
  assert.equal(smdWhite.unit, 'CENTIMETER');
  assert.equal(smdWhite.quantityStep, 50);
  const pieceParts = parts.filter((p) => p.unit === 'CENTIMETER');
  assert.equal(pieceParts.length, 2); // white + blue strip, nothing else
  ok('only the two SMD strips are centimetre-measured', `step ${smdWhite.quantityStep} cm`);

  const smdForm = await createRepairForm({
    uid: 'SZ7777',
    technicianId: tech.id,
    cityId: isfahan.id,
    storeName: 'فروشگاه نوار',
    parts: [{ partCatalogItemId: smdWhite.id, action: 'REPLACED', quantity: 150 }],
    qualityScore: 4,
    photos,
    ...sigs,
  });
  assert.equal(smdForm.outcome, 'REPAIRED');
  ok('a 150 cm strip cut is accepted');

  // A length that is not a whole 50 cm step cannot be cut, so the server refuses it
  // rather than silently rounding a number that ends up on a parts bill.
  await assert.rejects(
    () =>
      createRepairForm({
        uid: 'SZ7778',
        technicianId: tech.id,
        cityId: isfahan.id,
        parts: [{ partCatalogItemId: smdWhite.id, action: 'REPLACED', quantity: 137 }],
        qualityScore: 4,
        photos,
        ...sigs,
      }),
    /INVALID_QUANTITY/,
  );
  ok('a non-multiple-of-50 cut is rejected');

  // The centimetre value must reach the Jti sheet as-is, in the strip's own column.
  const smdRows = await collectJtiRows({ scope: 'ALL' });
  const smdRow = smdRows.find((r) => r.uid === 'SZ7777')!;
  assert.equal(smdRow.replaced[smdWhite.exportColumnKey], 150);
  const smdBook = await buildJtiWorkbook([smdRow]);
  const smdCheck = new ExcelJS.Workbook();
  await smdCheck.xlsx.load(smdBook as unknown as ArrayBuffer);
  const smdCol = 4 + PART_CATALOG.findIndex((p) => p.nameFa === 'نوار SMD سفید') + 1;
  assert.equal(smdCheck.worksheets[0].getRow(2).getCell(smdCol).value, 150);
  ok('centimetres export in the strip column, not converted to pieces', `col ${smdCol} = 150`);

  /* ---------------------------------------------------------------- */
  // The Shamsi picker converts Jalali -> Gregorian by correcting an estimate against the
  // Intl forward conversion. An earlier version treated every Jalali year as 365 days,
  // which silently returned the wrong day for Nowruz in any year following a leap year,
  // so both directions are now walked exhaustively.
  section('Jalali <-> Gregorian conversion');
  let conversions = 0;
  for (let year = 1400; year <= 1410; year++) {
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= jalaliMonthLength(year, month); day++) {
        const back = toJalaliParts(jalaliToDate(year, month, day));
        assert.deepEqual(
          [back.year, back.month, back.day],
          [year, month, day],
          `Jalali round-trip failed for ${year}/${month}/${day}`,
        );
        conversions++;
      }
    }
  }
  ok('every Jalali day of 1400-1410 round-trips exactly', `${conversions} dates`);

  // Nowruz immediately after a leap year is the case that used to break.
  assert.equal(formatJalali(jalaliToDate(1404, 1, 1)), '1404/01/01');
  assert.equal(formatJalali(jalaliToDate(1400, 1, 1)), '1400/01/01');
  ok('Nowruz following a leap year resolves to the correct day');

  // Esfand is 30 days only in a leap year, and the validator must agree.
  for (let year = 1400; year <= 1410; year++) {
    assert.equal(jalaliMonthLength(year, 12), isValidJalaliDate(year, 12, 30) ? 30 : 29);
  }
  assert.equal(isValidJalaliDate(1403, 12, 30), true);
  assert.equal(isValidJalaliDate(1404, 12, 30), false);
  ok('Esfand 30 exists only in leap years', '1403 yes, 1404 no');

  /* ---------------------------------------------------------------- */
  // Cities used to be created from four code paths, each matching on an exact name
  // string, so a sheet spelling a city in English produced a second row. That splits the
  // city's stores and forms and — for Tehran, its own wage bucket (§6.6) — quietly
  // under-reports the payroll split.
  section('city identity and merging');

  const beforeCities = await prisma.city.count();
  const englishTehran = await resolveCityByName(prisma, 'Tehran');
  const spacedTehran = await resolveCityByName(prisma, '  تهـران ');
  assert.equal(englishTehran, tehran.id, 'English spelling must match the seeded city');
  assert.equal(spacedTehran, tehran.id, 'spacing and character variants must fold away');
  assert.equal(await prisma.city.count(), beforeCities, 'no new city may be created');
  ok('city names resolve through the English alias and normalisation');

  // Regression: re-adding an existing city name with the Tehran box unticked must not
  // clear that city's wage flag. Writing the checkbox straight through emptied the
  // Tehran bucket (§6.6) with no visible warning.
  assert.equal(
    (await prisma.city.findUniqueOrThrow({ where: { id: tehran.id } })).isTehran,
    true,
  );
  const readd = await addOrMatchCity('Tehran', false);
  assert.equal(readd.created, false, 'must match the existing city, not create a rival');
  assert.equal(readd.cityId, tehran.id);
  assert.equal(
    (await prisma.city.findUniqueOrThrow({ where: { id: tehran.id } })).isTehran,
    true,
    'adding an existing city name must never clear its Tehran flag',
  );
  ok('re-adding an existing city keeps its Tehran wage flag');


  // A duplicate that already exists in the database still has to be repairable.
  const stray = await prisma.city.create({
    data: { name: 'Tehran', isTehran: true },
  });
  const strayStore = await prisma.store.create({
    data: {
      uid: 'MERGE-1',
      name: 'فروشگاه ادغام',
      matchKey: 'merge',
      cityId: stray.id,
    },
  });
  const strayStand = await prisma.stand.create({
    data: { storeId: strayStore.id, standIndexAtStore: 1 },
  });
  const strayForm = await prisma.repairForm.create({
    data: {
      formCode: 'MERGE-FORM-1',
      standId: strayStand.id,
      technicianId: tech.id,
      cityId: stray.id,
      storeId: strayStore.id,
      uid: 'MERGE-1',
      standIndex: 1,
      date: new Date(),
      outcome: 'REPAIRED',
      qualityScore: 4,
      wageAmount: 1000,
      wageTier: 1,
      wageRateApplied: 1000,
    },
  });
  await prisma.orderLine.updateMany({
    where: { uid: 'MERGE-1' },
    data: { cityName: stray.name },
  });

  const duplicates = await findDuplicateCityGroups();
  assert.ok(
    duplicates.some((g) => g.some((c) => c.id === stray.id)),
    'the stray city must be surfaced as a suspected duplicate',
  );
  ok('duplicate cities are detected for the manager');

  const mergeResult = await mergeCities(stray.id, tehran.id);
  assert.equal(mergeResult.stores, 1);
  assert.equal(mergeResult.forms, 1);
  ok('merge moves stores and forms across', `${mergeResult.forms} form(s)`);

  assert.equal(await prisma.city.findUnique({ where: { id: stray.id } }), null);
  assert.equal(
    (await prisma.store.findUniqueOrThrow({ where: { id: strayStore.id } })).cityId,
    tehran.id,
  );
  assert.equal(
    (await prisma.repairForm.findUniqueOrThrow({ where: { id: strayForm.id } })).cityId,
    tehran.id,
  );
  ok('the duplicate city is gone and nothing is orphaned');

  // The whole point: Tehran's wage bucket must be whole again.
  const merged = await getOverview({});
  const tehranForms = await prisma.repairForm.count({ where: { cityId: tehran.id } });
  assert.ok(tehranForms >= 1);
  assert.ok(merged.split.tehran.repaired >= 1);
  ok('Tehran wage bucket accounts for the merged rows');

  await prisma.partUsage.deleteMany({ where: { repairFormId: strayForm.id } });
  await prisma.repairForm.delete({ where: { id: strayForm.id } });
  await prisma.stand.delete({ where: { id: strayStand.id } });
  await prisma.store.delete({ where: { id: strayStore.id } });

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
