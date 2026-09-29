/**
 * A Prisma extension that refuses every write while the license is expired.
 *
 * Enforcing at the database client rather than in each server action means there is no
 * write path to forget: forms, imports, approvals and scripts all go through here. Reads
 * are never blocked — the data is the customer's, and they can always see and export it.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

import { getLicenseState } from './state';

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

const WRITE_SQL = /^\s*(insert|update|delete|merge|truncate|alter|drop|create)\b/i;

export class LicenseReadOnlyError extends Error {
  constructor() {
    super('LICENSE_READ_ONLY');
    this.name = 'LicenseReadOnlyError';
  }
}

/** Best-effort SQL text of a raw operation; empty when the shape is unfamiliar. */
function rawSqlText(args: unknown): string {
  if (typeof args === 'string') return args;
  if (Array.isArray(args)) return typeof args[0] === 'string' ? args[0] : '';
  if (args && typeof args === 'object') {
    const sql = (args as { sql?: unknown; strings?: unknown }).sql;
    if (typeof sql === 'string') return sql;
    const strings = (args as { strings?: unknown }).strings;
    if (Array.isArray(strings)) return strings.join('?');
  }
  return '';
}

function isWrite(model: string | undefined, operation: string, args: unknown): boolean {
  if (model) return WRITE_OPERATIONS.has(operation);
  if (operation.startsWith('$executeRaw')) return true;
  if (operation.startsWith('$queryRaw')) {
    const sql = rawSqlText(args);
    // Unknown shape: assume it writes — a false lock is recoverable, a bypass is not.
    return !sql || WRITE_SQL.test(sql);
  }
  return false;
}

export function licenseGuard(base: PrismaClient) {
  return Prisma.defineExtension({
    name: 'license-guard',
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (isWrite(model, operation, args) && (await getLicenseState(base)).readOnly) {
          throw new LicenseReadOnlyError();
        }
        return query(args);
      },
    },
  });
}
