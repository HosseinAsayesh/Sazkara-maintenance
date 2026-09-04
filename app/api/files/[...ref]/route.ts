import { getCurrentUser } from '@/lib/auth';
import { getStorage } from '@/lib/storage';

/**
 * Serves anything in the uploads directory.
 *
 * Uploads live outside `public/` on purpose: store photos, signatures and evidence PDFs
 * are commercially sensitive, and anything under `public/` would be world-readable by
 * URL. Every read goes through this handler, which requires a session first. The
 * adapter itself rejects refs that try to escape the uploads root.
 */
export async function GET(
  _request: Request,
  context: RouteContext<'/api/files/[...ref]'>,
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const { ref: segments } = await context.params;
  const ref = segments.map((s) => decodeURIComponent(s)).join('/');

  const storage = getStorage();

  try {
    if (!(await storage.exists(ref))) {
      return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const bytes = await storage.get(ref);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': storage.contentTypeOf(ref),
        'Content-Length': String(bytes.byteLength),
        // Refs are content-addressed by a random name and never rewritten in place.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
}
