/**
 * One-off repair for databases that accumulated duplicate cities before city creation was
 * normalised: `Tehran` sitting beside `تهران`, and so on.
 *
 * Dry-run by default. Pass `--apply` to perform the merges.
 *
 *   npx tsx --conditions=react-server scripts/merge-duplicate-cities.ts
 *   npx tsx --conditions=react-server scripts/merge-duplicate-cities.ts --apply
 *
 * Within each duplicate group the city with the most references wins, so the merge moves
 * as little data as possible; ties break toward the Persian-named row, which is the one
 * the rest of the UI shows.
 */
import { findDuplicateCityGroups, mergeCities, type CityUsage } from '../lib/cities';
import { prisma } from '../lib/prisma';

const apply = process.argv.includes('--apply');

/** Latin-only names are the imported spellings; the Persian row is the canonical one. */
function isPersian(name: string): boolean {
  return /[؀-ۿ]/.test(name);
}

function score(city: CityUsage): number {
  return city.stores + city.forms + city.evidence + city.orderLines;
}

function pickSurvivor(group: CityUsage[]): CityUsage {
  return [...group].sort((a, b) => {
    const byUsage = score(b) - score(a);
    if (byUsage !== 0) return byUsage;
    const byScript = Number(isPersian(b.name)) - Number(isPersian(a.name));
    if (byScript !== 0) return byScript;
    return a.name.localeCompare(b.name, 'fa');
  })[0];
}

async function main() {
  const groups = await findDuplicateCityGroups();

  if (groups.length === 0) {
    console.log('No duplicate cities found.');
    return;
  }

  console.log(`${groups.length} duplicate group(s)${apply ? '' : '  (dry run)'}\n`);

  for (const group of groups) {
    const survivor = pickSurvivor(group);
    const losers = group.filter((c) => c.id !== survivor.id);

    console.log(`keep  → ${survivor.name}  (${score(survivor)} refs)`);
    for (const loser of losers) {
      console.log(`merge → ${loser.name}  (${score(loser)} refs)`);
      if (apply) {
        const moved = await mergeCities(loser.id, survivor.id);
        console.log(
          `        moved ${moved.stores} stores, ${moved.forms} forms, ` +
            `${moved.orderLines} order lines, ${moved.evidenceMoved} evidence packs` +
            (moved.evidenceDiscarded
              ? ` (${moved.evidenceDiscarded} duplicate packs discarded)`
              : ''),
        );
      }
    }
    console.log('');
  }

  if (!apply) console.log('Nothing changed. Re-run with --apply to perform the merges.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
