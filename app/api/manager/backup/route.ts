import { Readable } from 'node:stream';

import { getCurrentUser } from '@/lib/auth';
import { isBackupPart, planBackup, streamBackup, type BackupPart } from '@/lib/backup';

// A full backup can run for minutes; it streams, so nothing here is cached or buffered.
export const dynamic = 'force-dynamic';

/**
 * The manager's manual backup (Settings › Backup), streamed as a zip.
 *
 *   /api/manager/backup?parts=projects,orders,uids,reRepairs,photos&projectId=<id|all>
 *
 * `X-Backup-Estimate` carries the expected size before the first byte, so the browser can
 * draw real progress for a download whose length is not known up front.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (user.role !== 'MANAGER') return Response.json({ error: 'FORBIDDEN' }, { status: 403 });

  const url = new URL(request.url);
  const parts = new Set<BackupPart>(
    (url.searchParams.get('parts') ?? '').split(',').filter(isBackupPart),
  );
  if (!parts.size) return Response.json({ error: 'NOTHING_SELECTED' }, { status: 400 });
  const projectId = url.searchParams.get('projectId') || 'all';

  const plan = await planBackup({ parts, projectId });
  const stream = streamBackup(plan);

  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="backup.zip"; filename*=UTF-8''${encodeURIComponent(
        `${plan.rootName}.zip`,
      )}`,
      'X-Backup-Estimate': String(plan.estimatedBytes),
      'X-Backup-Files': String(plan.entries.length),
      'Cache-Control': 'no-store',
      // nginx would otherwise hold the whole stream back before passing it on.
      'X-Accel-Buffering': 'no',
    },
  });
}
