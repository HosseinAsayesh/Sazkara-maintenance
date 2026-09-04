import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';

/**
 * Human-readable sequential codes.
 *
 * Uses a single atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` so two
 * technicians submitting at the same instant can never be handed the same form code —
 * a read-then-write in application code would race here.
 */
async function nextValue(key: string, tx?: Prisma.TransactionClient): Promise<number> {
  const client = tx ?? prisma;
  const rows = await client.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"
  `;
  return rows[0].value;
}

/** `SZ-000123` — export column 42. */
export async function nextFormCode(tx?: Prisma.TransactionClient): Promise<string> {
  const n = await nextValue('repairForm', tx);
  return `SZ-${String(n).padStart(6, '0')}`;
}

/** `TC-001` — export column 41. Assigned when a manager approves a technician. */
export async function nextTechnicianCode(tx?: Prisma.TransactionClient): Promise<string> {
  const n = await nextValue('technician', tx);
  return `TC-${String(n).padStart(3, '0')}`;
}
