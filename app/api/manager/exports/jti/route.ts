import JSZip from 'jszip';

import { getCurrentUser } from '@/lib/auth';
import { localDayRange } from '@/lib/dates';
import {
  buildJtiWorkbook,
  buildJtiWorkbooksPerCity,
  collectJtiRows,
  rangeLabel,
  safeFilename,
  type JtiExportScope,
} from '@/lib/exports/jti';

/**
 * §8 — the Jti export.
 *
 * Two independent axes:
 *
 *  `layout` — `combined` returns one workbook, `perCity` returns a zip with one workbook
 *  per city, which is the shape Jti actually receives.
 *
 *  `scope`  — `MAIN` is every stand repaired in the range except within-project
 *  re-repairs; `RE_REPAIR` is only those; `ALL` merges them. Stands that were also
 *  repaired in an EARLIER project stay in MAIN (they are ordinary recurring work) but
 *  are tinted so the manager can pick them out.
 *
 * A date range may span several phases — the query filters on repair date, never on
 * batch, so phase 1 + phase 2 combine into a single submission as the spec requires.
 * `projectId`/`phaseId` narrow it further when the manager wants one campaign only.
 */
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
  const layout = url.searchParams.get('layout') || 'combined';

  const requestedScope = (url.searchParams.get('scope') || 'MAIN').toUpperCase();
  const scope: JtiExportScope = (['MAIN', 'RE_REPAIR', 'ALL'] as const).includes(
    requestedScope as JtiExportScope,
  )
    ? (requestedScope as JtiExportScope)
    : 'MAIN';

  const range = localDayRange(from, to);

  const rows = await collectJtiRows({
    from: range.from,
    to: range.to,
    cityId,
    projectId,
    phaseId,
    scope,
  });

  if (rows.length === 0) {
    return Response.json({ error: 'NO_ROWS' }, { status: 404 });
  }

  const label = rangeLabel(from, to);
  const kind = scope === 'RE_REPAIR' ? 'Jti تعمیرات مجدد' : 'Jti';

  if (layout === 'perCity') {
    const bundles = await buildJtiWorkbooksPerCity(rows, label, scope);
    const zip = new JSZip();
    for (const bundle of bundles) zip.file(bundle.filename, bundle.buffer);
    const archive = await zip.generateAsync({ type: 'nodebuffer' });

    return new Response(new Uint8Array(archive), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(
          safeFilename(`${kind} ${label}`),
        )}.zip"`,
      },
    });
  }

  const workbook = await buildJtiWorkbook(rows, scope);
  return new Response(new Uint8Array(workbook), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(
        safeFilename(`${kind} ${label}`),
      )}.xlsx"`,
    },
  });
}
