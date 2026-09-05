import { getCurrentUser } from '@/lib/auth';
import { localDayRange } from '@/lib/dates';
import { rangeLabel, safeFilename } from '@/lib/exports/jti';
import { buildWorkWorkbook, collectWorkRows } from '@/lib/exports/technician-work';
import { prisma } from '@/lib/prisma';

/**
 * "What did I / my crew do in this period?" as a spreadsheet.
 *
 * One route rather than three, because the only thing that differs by role is WHICH
 * technicians the caller may see — and that is exactly the decision that must not be
 * duplicated across handlers:
 *
 *   TECHNICIAN      — their own work, always. A `technicianId` in the query is ignored
 *                     rather than honoured, so the parameter cannot be used to read a
 *                     colleague's record.
 *   LEAD_TECHNICIAN — their own crew, plus themselves. A request for someone outside the
 *                     crew is refused, not silently widened or silently emptied.
 *   MANAGER         — anyone.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const projectId = url.searchParams.get('projectId') || undefined;
  const phaseId = url.searchParams.get('phaseId') || undefined;
  const requested = url.searchParams.get('technicianId') || '';

  // --- who the caller may see -----------------------------------------------
  let technicianIds: string[];
  let scopeLabel: string;

  if (user.role === 'TECHNICIAN') {
    technicianIds = [user.id];
    scopeLabel = user.technicianCode || user.name;
  } else if (user.role === 'LEAD_TECHNICIAN') {
    const crew = await prisma.user.findMany({
      where: { leadId: user.id },
      select: { id: true, name: true, technicianCode: true },
    });
    const allowed = new Set([user.id, ...crew.map((c) => c.id)]);

    if (requested) {
      if (!allowed.has(requested)) {
        return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
      }
      technicianIds = [requested];
      const member = crew.find((c) => c.id === requested);
      scopeLabel = member ? member.technicianCode || member.name : user.name;
    } else {
      technicianIds = [...allowed];
      scopeLabel = `${user.name} — گروه`;
    }
  } else {
    // Manager: any single technician, or everyone when unspecified.
    if (requested) {
      const member = await prisma.user.findUnique({
        where: { id: requested },
        select: { name: true, technicianCode: true },
      });
      if (!member) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
      technicianIds = [requested];
      scopeLabel = member.technicianCode || member.name;
    } else {
      technicianIds = [];
      scopeLabel = 'همه تکنسین‌ها';
    }
  }

  const range = localDayRange(from, to);
  const rows = await collectWorkRows({
    technicianIds,
    from: range.from,
    to: range.to,
    projectId,
    phaseId,
  });

  if (rows.length === 0) return Response.json({ error: 'NO_ROWS' }, { status: 404 });

  const label = rangeLabel(from, to);
  const workbook = await buildWorkWorkbook(rows, `${scopeLabel} · ${label}`);

  return new Response(new Uint8Array(workbook), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(
        safeFilename(`کارکرد ${scopeLabel} ${label}`),
      )}.xlsx"`,
    },
  });
}
