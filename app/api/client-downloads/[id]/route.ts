import {
  contentTypeForKind,
  extensionForKind,
  isDownloadable,
} from '@/lib/client-downloads';
import { getCurrentUser } from '@/lib/auth';
import { safeFilename } from '@/lib/exports/jti';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';

/**
 * Serves a file the manager approved.
 *
 * Three things are re-checked here rather than trusted from the page that linked here:
 * that the caller is the person whose request it was (or a manager), that it was
 * approved, and that the approval has not expired. A download URL is the one part of
 * this flow that can be pasted into an email, so it has to stand on its own.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  const req = await prisma.downloadRequest.findUnique({
    where: { id },
    include: { project: { select: { name: true } } },
  });
  if (!req) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });

  const isOwner = req.requestedById === user.id;
  if (!isOwner && user.role !== 'MANAGER') {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  if (!isDownloadable(req)) {
    // Distinguished from a refusal: an expired approval is asked for again, a denial is
    // argued with. Telling Jti which one it is saves a message either way.
    const reason =
      req.status !== 'APPROVED'
        ? 'NOT_APPROVED'
        : req.expiresAt && req.expiresAt.getTime() < Date.now()
          ? 'EXPIRED'
          : 'NOT_READY';
    return Response.json({ error: reason }, { status: 409 });
  }

  const storage = getStorage();
  const buffer = await storage.get(req.fileRef as string);

  // First fetch stamps the download, so the manager can see whether what they released
  // was ever actually collected.
  if (!req.downloadedAt) {
    await prisma.downloadRequest.update({
      where: { id },
      data: { downloadedAt: new Date() },
    });
  }

  const name = safeFilename(`${req.project.name} ${req.kind}`);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': contentTypeForKind(req.kind),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.${extensionForKind(req.kind)}"`,
    },
  });
}
