import { getCurrentUser } from '@/lib/auth';
import { formatJalali } from '@/lib/dates';
import { safeFilename } from '@/lib/exports/jti';
import { generateEvidencePdf } from '@/lib/pdf/evidence';

/**
 * §9, re-repair variant — the evidence pack for a city/day restricted to within-project
 * re-repairs.
 *
 * Streamed straight to the browser rather than cached: `EvidencePdfBatch` is keyed on
 * (city, day) and that row belongs to the main pack, so caching this one there would
 * overwrite it. Re-repair packs are small and rarely regenerated, which makes the
 * on-demand render the cheaper trade.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (user.role !== 'MANAGER') return Response.json({ error: 'FORBIDDEN' }, { status: 403 });

  const url = new URL(request.url);
  const cityId = url.searchParams.get('cityId');
  const dateIso = url.searchParams.get('date');

  if (!cityId || !dateIso) {
    return Response.json({ error: 'MISSING_PARAMS' }, { status: 400 });
  }

  // Midday keeps the parsed instant inside the intended Tehran-local day.
  const date = new Date(`${dateIso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return Response.json({ error: 'BAD_DATE' }, { status: 400 });
  }

  const { buffer, standCount, cityName } = await generateEvidencePdf({
    cityId,
    date,
    onlyReRepairs: true,
  });

  if (standCount === 0) {
    return Response.json({ error: 'NO_VISITS' }, { status: 404 });
  }

  const name = safeFilename(`${cityName} - ${formatJalali(date)} - تعمیرات مجدد`);

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.pdf"`,
    },
  });
}
