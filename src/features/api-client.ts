// One HTTP client for every screen: the same API origin rule, the same error shape. A feature adds
// its own typed calls on top rather than its own fetch.
export const apiOrigin = (process.env.NEXT_PUBLIC_API_ORIGIN ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}/api/v1/${path}`, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? (data as { error?: { code?: string; message?: string } }).error : null;
    throw new ApiError(response.status, error?.code ?? 'REQUEST_FAILED', error?.message ?? '요청을 처리하지 못했어요. 다시 시도해 주세요.');
  }
  return data as T;
}
