/**
 * Seed: the 30-part catalogue, a starting set of cities, wage/app settings, and the
 * first manager account. Idempotent — safe to re-run.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { PART_CATALOG } from '../lib/parts';

const prisma = new PrismaClient();

const CITIES: Array<{ name: string; nameEn: string; isTehran: boolean }> = [
  { name: 'تهران', nameEn: 'Tehran', isTehran: true },
  { name: 'اصفهان', nameEn: 'Isfahan', isTehran: false },
  { name: 'مشهد', nameEn: 'Mashhad', isTehran: false },
  { name: 'شیراز', nameEn: 'Shiraz', isTehran: false },
  { name: 'تبریز', nameEn: 'Tabriz', isTehran: false },
  { name: 'کرج', nameEn: 'Karaj', isTehran: false },
];

/**
 * Starting wage rates in Toman. These are placeholders — the manager edits them in
 * Settings; nothing in the app reads a hardcoded rate (§6.6).
 */
const WAGE_SEED: Record<string, number> = {
  tehranStandRate: 150000,
  otherCityStandRate: 200000,
  secondStandRate: 90000,
  thirdPlusStandRate: 70000,
  // Paid for a visit that produced no repair — the technician travelled either way.
  unrepairedVisitRate: 50000,
};

async function main() {
  // --- Parts (§8): the order here IS the export column order. ------------------
  for (const part of PART_CATALOG) {
    await prisma.partCatalogItem.upsert({
      where: { exportColumnKey: part.exportColumnKey },
      create: {
        nameFa: part.nameFa,
        nameEn: part.nameEn,
        exportColumnKey: part.exportColumnKey,
        sortOrder: part.sortOrder,
        unit: part.unit,
        quantityStep: part.quantityStep,
      },
      update: {
        nameFa: part.nameFa,
        nameEn: part.nameEn,
        sortOrder: part.sortOrder,
        // Units are a catalogue fact, not a manager preference, so they are kept in
        // sync on every seed run.
        unit: part.unit,
        quantityStep: part.quantityStep,
        active: true,
      },
    });
  }
  console.log(`✓ ${PART_CATALOG.length} part catalogue items`);

  // --- Cities ------------------------------------------------------------------
  for (const city of CITIES) {
    await prisma.city.upsert({
      where: { name: city.name },
      create: city,
      update: { nameEn: city.nameEn, isTehran: city.isTehran },
    });
  }
  console.log(`✓ ${CITIES.length} cities (Tehran flagged for the wage split)`);

  // --- Settings ----------------------------------------------------------------
  for (const [key, value] of Object.entries(WAGE_SEED)) {
    await prisma.wageSetting.upsert({
      where: { key },
      create: { key, value },
      update: {}, // never overwrite rates the manager has already edited
    });
  }
  console.log('✓ wage settings');

  const managerEmail = process.env.SEED_MANAGER_EMAIL || 'repairs@sazkara.example';
  for (const [key, value] of Object.entries({
    companyName: 'سازکارا',
    managerContactEmail: managerEmail,
    logoRef: '',
  })) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }
  console.log('✓ app settings');

  // --- Default project ---------------------------------------------------------
  // The project boundary is what defines a re-repair, so every installation needs at
  // least one. Any batch or form that predates the project register is adopted into it,
  // otherwise those rows would sit outside every project filter and disappear from the
  // dashboard's default view.
  const existingProject = await prisma.project.findFirst();
  if (!existingProject) {
    const project = await prisma.project.create({
      data: {
        name: 'پروژه‌ی جاری',
        code: 'P-1',
        startDate: new Date(),
        isActive: true,
        phases: {
          create: [
            { name: 'فاز ۱', sortOrder: 1 },
            { name: 'فاز ۲', sortOrder: 2 },
          ],
        },
      },
      include: { phases: { orderBy: { sortOrder: 'asc' } } },
    });

    const firstPhase = project.phases[0];
    const adoptedBatches = await prisma.importBatch.updateMany({
      where: { projectId: null, source: { not: 'HISTORICAL' } },
      data: { projectId: project.id, phaseId: firstPhase.id },
    });
    const adoptedForms = await prisma.repairForm.updateMany({
      where: { projectId: null },
      data: { projectId: project.id, phaseId: firstPhase.id },
    });

    console.log(
      `✓ project "${project.name}" with ${project.phases.length} phases ` +
        `(adopted ${adoptedBatches.count} orders, ${adoptedForms.count} reports)`,
    );
  } else {
    console.log(`✓ project register already populated`);
  }

  // --- First manager account ---------------------------------------------------
  const phone = process.env.SEED_MANAGER_PHONE || '09120000000';
  const password = process.env.SEED_MANAGER_PASSWORD || 'manager1234';
  const name = process.env.SEED_MANAGER_NAME || 'مدیر تعمیرات';

  await prisma.user.upsert({
    where: { phone },
    create: {
      name,
      phone,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'MANAGER',
      status: 'APPROVED',
    },
    update: { role: 'MANAGER', status: 'APPROVED' },
  });
  console.log(`✓ manager account — phone: ${phone}  password: ${password}`);

  // Counters start at 0; nextFormCode()/nextTechnicianCode() create them on demand.
  console.log('\nSeed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
