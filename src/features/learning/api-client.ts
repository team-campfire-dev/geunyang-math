import type { ActionResponse, ClassDocument, LearningAction, LearningState, PublicClass } from '@/shared/api';

export type Session = { user: { id: string; displayName: string } | null; developmentLogin: boolean };
const apiOrigin = (process.env.NEXT_PUBLIC_API_ORIGIN ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

export const learningApi = {
  session: () => request<Session>('session'),
  catalog: () => request<{ classes: PublicClass[] }>('learning?catalog=1'),
  state: () => request<LearningState>('learning'),
  class: (key: string) => request<ClassDocument>(`learning?classKey=${encodeURIComponent(key)}`),
  login: (displayName: string) => request<Session>('dev-session', { method: 'POST', body: JSON.stringify({ displayName }) }),
  logout: () => request<unknown>('session', { method: 'DELETE' }),
  action: (action: LearningAction) => request<ActionResponse>('learning', { method: 'POST', body: JSON.stringify(action) }),
};
