import { getCurrentUser } from '@/lib/auth';
import { safeFilename } from '@/lib/exports/jti';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';

/**
 * A weekly report's file: `?as=xlsx` (default), `?as=pdf` for the evidence PDF (photos
 * and signatures, with the approval page once signed), or `?as=signature` for the
 * approver's signature image. Manager and the Jti account only.
 *
 * Jti's first download of either format is what unlocks their approval — the record that
 * they saw the report before signing it. A manager looking does not count.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (user.role !== 'MANAGER' && user.role !== 'CLIENT_SUPERVISOR') {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = await params;
  const report = await prisma.weeklyReport.findUnique({ where: { id } });
  if (!report) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });

  const as = new URL(request.url).searchParams.get('as') ?? 'xlsx';
  const storage = getStorage();

  if (as === 'signature') {
    if (!report.approverSignatureRef) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    const bytes = await storage.get(report.approverSignatureRef);
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' },
    });
  }

  if (user.role === 'CLIENT_SUPERVISOR' && !report.firstViewedAt) {
    await prisma.weeklyReport.update({ where: { id }, data: { firstViewedAt: new Date() } });
  }

  const base = safeFilename(report.title.replace(/\//g, '.'));

  if (as === 'pdf') {
    // Reports sent before v0.6.1 carry no evidence PDF.
    if (!report.evidenceFileRef || !(await storage.exists(report.evidenceFileRef))) {
      return Response.json({ error: 'NO_EVIDENCE' }, { status: 404 });
    }
    const pdf = await storage.get(report.evidenceFileRef);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(base)}.pdf"`,
      },
    });
  }

  const bytes = await storage.get(report.fileRef);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(base)}.xlsx"`,
    },
  });
}
