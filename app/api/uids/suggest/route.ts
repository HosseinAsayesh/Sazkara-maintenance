import { requireApiUser } from '@/lib/auth';
import { suggestUids } from '@/lib/uid-lookup';

/**
 * `?q=` → up to ten uids for the search-as-you-type list: open order rows first, then
 * every other known uid. Field staff and the manager only — Jti's view never types uids.
 */
export async function GET(request: Request) {
  let user;
  try {
    user = await requireApiUser();
  } catch (res) {
    return res as Response;
  }
  if (user.role === 'CLIENT_SUPERVISOR') {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  const q = new URL(request.url).searchParams.get('q') ?? '';
  return Response.json({ items: await suggestUids(q) });
}
