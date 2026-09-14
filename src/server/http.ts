import { ZodError } from 'zod';
import { AppError } from './errors';

export function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
export async function readJson(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError(415, 'content_type', 'JSON 요청이 필요합니다.');
  if (Number(request.headers.get('content-length') || 0) > 8192) throw new AppError(413, 'too_large', '입력이 너무 깁니다.');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, 'invalid_json', '입력을 확인해 주세요.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.length;
    if (size > 8192) { await reader.cancel(); throw new AppError(413, 'too_large', '입력이 너무 깁니다.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AppError(400, 'invalid_json', '입력을 확인해 주세요.'); }
}
export async function handle(work: () => Promise<Response>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof ZodError) return json({ error: { code: 'invalid_input', message: '입력 형식을 확인해 주세요.' } }, 400);
    console.error(JSON.stringify({ event: 'request_failed', type: error instanceof Error ? error.name : 'unknown' }));
    return json({ error: { code: 'internal_error', message: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.' } }, 500);
  }
}
