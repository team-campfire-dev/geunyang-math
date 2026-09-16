import { getDatabase } from '@/server/db';
import { json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const db = getDatabase();
    const [lessons, skills, diagnostics] = await Promise.all([db.lessonVersion.count(), db.skill.count(), db.diagnosticVersion.count({ where: { diagnosticKey: 'starting-point' } })]);
    const ready = lessons > 0 && skills > 0 && diagnostics > 0;
    return json({ status: ready ? 'ready' : 'unseeded' }, ready ? 200 : 503);
  } catch { return json({ status: 'unavailable' }, 503); }
}
