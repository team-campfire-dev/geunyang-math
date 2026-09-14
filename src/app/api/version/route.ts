export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ version: '0.1.0', commit: process.env.NEXT_PUBLIC_BUILD_COMMIT || 'development', contentSchema: '0.2' }, { headers: { 'Cache-Control': 'no-store' } });
}
