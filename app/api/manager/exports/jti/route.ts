import JSZip from 'jszip';

import { getCurrentUser } from '@/lib/auth';
import { localDayRange } from '@/lib/dates';
import {
  buildJtiWorkbook,
  buildJtiWorkbooksPerCity,
  collectJtiRows,
  rangeLabel,
  safeFilename,
} from '@/lib/exports/jti';

/**
 * §8 — the Jti export.
 *
 * `scope=combined` returns one workbook; `scope=perCity` returns a zip with one workbook
 * per city, which is the shape Jti actually receives. A date range may span several
 * import phases — the query filters on repair date, never on batch, so phase 1 + phase 2
 * combine into a single submission exactly as the spec requires.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (user.role !== 'MANAGER') return Response.json({ error: 'FORBIDDEN' }, { status: 403 });

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const cityId = url.searchParams.get('cityId') || undefined;
  const scope = url.searchParams.get('scope') || 'combined';
  const includeReRepairs = url.searchParams.get('includeReRepairs') !== 'false';

  const range = localDayRange(from, to);

  const rows = await collectJtiRows({
    from: range.from,
    to: range.to,
    cityId,
    includeReRepairs,
  });

  if (rows.length === 0) {
    return Response.json({ error: 'NO_ROWS' }, { status: 404 });
  }

  const label = rangeLabel(from, to);

  if (scope === 'perCity') {
    const bundles = await buildJtiWorkbooksPerCity(rows, label);
    const zip = new JSZip();
    for (const bundle of bundles) zip.file(bundle.filename, bundle.buffer);
    const archive = await zip.generateAsync({ type: 'nodebuffer' });

    return new Response(new Uint8Array(archive), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(
          safeFilename(`Jti ${label}`),
        )}.zip"`,
      },
    });
  }

  const workbook = await buildJtiWorkbook(rows);
  return new Response(new Uint8Array(workbook), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(
        safeFilename(`Jti ${label}`),
      )}.xlsx"`,
    },
  });
}
