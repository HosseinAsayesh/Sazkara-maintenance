import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { FormEditor, type EditableForm } from '@/components/FormEditor';
import { requireManager } from '@/lib/auth';
import { formatGregorian } from '@/lib/dates';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function ManagerFormPage({
  params,
}: PageProps<'/[locale]/manager/form/[formId]'>) {
  const { locale, formId } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const form = await prisma.repairForm.findUnique({
    where: { id: formId },
    include: {
      technician: { select: { technicianCode: true } },
      parts: { select: { partCatalogItemId: true, action: true, quantity: true } },
      photos: { orderBy: { index: 'asc' } },
    },
  });
  if (!form) notFound();

  const [parts, cities] = await Promise.all([
    prisma.partCatalogItem.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        nameFa: true,
        nameEn: true,
        sortOrder: true,
        unit: true,
        quantityStep: true,
      },
    }),
    prisma.city.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  const storage = getStorage();

  // The picker speaks {partId: quantity}; split the stored usages back into its two lists.
  const replaced: Record<string, number> = {};
  const repaired: Record<string, number> = {};
  for (const usage of form.parts) {
    const target = usage.action === 'REPLACED' ? replaced : repaired;
    target[usage.partCatalogItemId] = usage.quantity;
  }

  const editable: EditableForm = {
    id: form.id,
    formCode: form.formCode,
    uid: form.uid,
    standIndex: form.standIndex,
    // The Jalali picker round-trips through ISO Gregorian like every other date field.
    date: formatGregorian(form.date),
    cityId: form.cityId,
    storeName: form.storeName,
    storeAddress: form.storeAddress,
    storeManagerName: form.storeManagerName,
    storePhone: form.storePhone,
    digitalAddress: form.digitalAddress,
    timeSpentMinutes: form.timeSpentMinutes,
    qualityScore: form.qualityScore,
    notes: form.notes,
    outcome: form.outcome,
    notRepairedReason: form.notRepairedReason,
    isReRepair: form.isReRepair,
    technicianCode: form.technician.technicianCode,
    replaced,
    repaired,
    photoUrls: [
      ...form.photos.map((p) => ({ type: p.type as string, url: storage.url(p.fileRef) })),
      ...(form.technicianSignature
        ? [{ type: 'TECH_SIGNATURE', url: storage.url(form.technicianSignature) }]
        : []),
      ...(form.storeManagerSignature
        ? [{ type: 'MANAGER_SIGNATURE', url: storage.url(form.storeManagerSignature) }]
        : []),
    ],
  };

  return <FormEditor locale={locale} form={editable} parts={parts} cities={cities} />;
}
