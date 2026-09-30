import 'server-only';

import { prisma } from './prisma';

/**
 * The shared JTI supervisor login. The client asked for one account for its whole team,
 * so the app manages exactly one: the oldest CLIENT_SUPERVISOR, should an older install
 * ever have produced more.
 */
export function findClientAccount() {
  return prisma.user.findFirst({
    where: { role: 'CLIENT_SUPERVISOR' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, phone: true, status: true },
  });
}
