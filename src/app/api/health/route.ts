import { getDatabase } from '@/server/db';
import { json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const classes = await getDatabase().classVersion.count();
    return json({ status: classes ? 'ready' : 'unseeded' }, classes ? 200 : 503);
  } catch { return json({ status: 'unavailable' }, 503); }
}
