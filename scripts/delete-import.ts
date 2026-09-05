/**
 * Remove a historical import and everything it created.
 *
 * A part-committed import cannot be undone from the Jti orders screen: that delete
 * deliberately refuses once any uid carries a repair report, because a report is
 * fieldwork and outranks the order that requested it. For a HISTORICAL import that rule
 * is wrong — the "reports" are rows of a spreadsheet, and a botched import leaves them
 * stranded with no way back.
 *
 * Lists imports by default. Pass ids (or a name) plus --apply to delete.
 *
 *   npx tsx --conditions=react-server scripts/delete-import.ts
 *   npx tsx --conditions=react-server scripts/delete-import.ts --name "PO1164_Rasht" --apply
 *   npx tsx --conditions=react-server scripts/delete-import.ts --id abc123 --id def456 --apply
 *
 * Only HISTORICAL imports can be removed; a live Jti order is never touched.
 */
import { prisma } from '../lib/prisma';
import { getStorage } from '../lib/storage';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');

function flagValues(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}

const wantedIds = flagValues('--id');
const wantedNames = flagValues('--name');

async function main() {
  const all = await prisma.importBatch.findMany({
    where: { source: 'HISTORICAL' },
    orderBy: { importedAt: 'asc' },
    include: {
      project: { select: { name: true } },
      phase: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  });

  const selected = all.filter(
    (b) =>
      wantedIds.includes(b.id) ||
      wantedNames.some((n) => b.name.toLowerCase().includes(n.toLowerCase())),
  );

  if (selected.length === 0) {
    console.log('historical imports:\n');
    for (const b of all) {
      console.log(
        `  ${b.id}  ${b.importedAt.toISOString().slice(0, 16)}  ` +
          `${b.name.padEnd(26)} lines=${String(b._count.lines).padStart(4)}  ` +
          `project=${b.project?.name ?? '-'} / ${b.phase?.name ?? '-'}`,
      );
    }
    console.log('\nPass --name <text> or --id <id> to select, then --apply to delete.');
    return;
  }

  console.log(`${selected.length} import(s) selected${apply ? '' : '  (dry run)'}:\n`);

  for (const batch of selected) {
    const uids = [
      ...new Set(
        (
          await prisma.orderLine.findMany({
            where: { batchId: batch.id },
            select: { uid: true },
          })
        ).map((l) => l.uid),
      ),
    ];

    // Only forms written by the archive importer are in scope. A technician's real report
    // for the same uid must survive, whatever the archive did.
    const forms = await prisma.repairForm.findMany({
      where: { uid: { in: uids }, technician: { technicianCode: 'LEGACY' } },
      select: { id: true, technicianSignature: true, storeManagerSignature: true },
    });
    const formIds = forms.map((f) => f.id);

    const photos = await prisma.photo.findMany({
      where: { repairFormId: { in: formIds } },
      select: { fileRef: true },
    });

    console.log(
      `  ${batch.name}: ${batch._count.lines} order lines, ${formIds.length} archived forms`,
    );

    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      await tx.partUsage.deleteMany({ where: { repairFormId: { in: formIds } } });
      await tx.photo.deleteMany({ where: { repairFormId: { in: formIds } } });
      await tx.repairForm.deleteMany({ where: { id: { in: formIds } } });
      await tx.orderLine.deleteMany({ where: { batchId: batch.id } });
      await tx.importBatch.delete({ where: { id: batch.id } });

      // Stores and stands only go if nothing else references them.
      for (const uid of uids) {
        const stillUsed =
          (await tx.repairForm.count({ where: { uid } })) +
          (await tx.orderLine.count({ where: { uid } }));
        if (stillUsed === 0) {
          await tx.stand.deleteMany({ where: { store: { uid } } });
          await tx.store.deleteMany({ where: { uid } });
        }
      }
    });

    // Files last, so a rolled-back transaction never leaves dangling references.
    const storage = getStorage();
    const refs = [
      ...photos.map((p) => p.fileRef),
      ...forms.flatMap((f) => [f.technicianSignature, f.storeManagerSignature]),
      batch.fileRef,
    ].filter((r): r is string => !!r);
    await Promise.all(refs.map((ref) => storage.delete(ref).catch(() => {})));

    console.log(`    removed.`);
  }

  if (!apply) console.log('\nNothing changed. Re-run with --apply.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
