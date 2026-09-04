import { getCurrentUser } from '@/lib/auth';
import { localDayRange } from '@/lib/dates';
import {
  buildPartsUsageReport,
  buildPartsUsageWorkbook,
} from '@/lib/exports/parts-usage';
import { rangeLabel, safeFilename } from '@/lib/exports/jti';

/** §6.8 / §7 — the parts-usage summary accounting receives. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (user.role !== 'MANAGER') return Response.json({ error: 'FORBIDDEN' }, { status: 403 });

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const cityId = url.searchParams.get('cityId') || undefined;
  const projectId = url.searchParams.get('projectId') || undefined;
  const phaseId = url.searchParams.get('phaseId') || undefined;

  const range = localDayRange(from, to);
  const report = await buildPartsUsageReport({
    from: range.from,
    to: range.to,
    cityId,
    projectId,
    phaseId,
  });

  const label = rangeLabel(from, to);

  const workbook = await buildPartsUsageWorkbook(report, label);

  return new Response(new Uint8Array(workbook), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(
        safeFilename(`Parts ${label}`),
      )}.xlsx"`,
    },
  });
}
