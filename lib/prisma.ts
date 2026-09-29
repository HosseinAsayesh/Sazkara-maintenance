import { PrismaClient } from '@prisma/client';

import { licenseGuard } from './license/guard';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The raw client. Only the license module may use it directly — everything else goes
 * through `prisma` below, so an expired license blocks every write path at once.
 */
export const unguardedPrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

// Survive the dev-server hot reload without leaking connections.
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = unguardedPrisma;

// The guard is a query-only extension: it changes no model or result types, so the
// extended client is typed as the plain one and `Prisma.TransactionClient` keeps working.
export const prisma = unguardedPrisma.$extends(
  licenseGuard(unguardedPrisma),
) as unknown as PrismaClient;
