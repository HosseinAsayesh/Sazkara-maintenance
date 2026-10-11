import { getCurrentUser } from '@/lib/auth';
import { safeFilename } from '@/lib/exports/jti';
import { buildRemainingWorkbook, collectRemainingRows } from '@/lib/exports/remaining';
import { prisma } from '@/lib/prisma';

/** The dashboard's «remaining» UIDs, as Excel, for the filters the manager is looking at. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (user.role !== 'MANAGER') return Response.json({ error: 'FORBIDDEN' }, { status: 403 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') || undefined;
  const phaseId = url.searchParams.get('phaseId') || undefined;
  const cityId = url.searchParams.get('cityId') || undefined;

  const rows = await collectRemainingRows({ projectId, phaseId, cityId });

  // The file says what it holds: project, phase and city where one was chosen.
  const [project, phase, city] = await Promise.all([
    projectId && projectId !== 'all' && projectId !== '__none__'
      ? prisma.project.findUnique({ where: { id: projectId }, select: { name: true } })
      : null,
    phaseId && phaseId !== 'all'
      ? prisma.phase.findUnique({ where: { id: phaseId }, select: { name: true } })
      : null,
    cityId ? prisma.city.findUnique({ where: { id: cityId }, select: { name: true } }) : null,
  ]);
  const title =
    [project?.name, phase?.name, city?.name].filter(Boolean).join(' - ') || 'همه پروژه‌ها';

  const workbook = await buildRemainingWorkbook(rows, title);

  return new Response(new Uint8Array(workbook), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(
        safeFilename(`UID باقی‌مانده - ${title}`),
      )}.xlsx"`,
    },
  });
}
