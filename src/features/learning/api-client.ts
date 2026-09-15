import type { ActionResponse, ClassDocument, LearningAction, LearningState, PublicCatalog } from '@/shared/api';
import { apiOrigin, apiRequest as request } from '../api-client';
import { canUseWebAuthentication } from './auth-client';

export { ApiError } from '../api-client';
export type Session = { user: { id: string; displayName: string } | null; developmentLogin: boolean; googleLogin: boolean };

export function supportsWebAuthentication(browserOrigin: string, nativePlatform: boolean) {
  return canUseWebAuthentication(apiOrigin, browserOrigin, nativePlatform);
}

export const learningApi = {
  session: () => request<Session>('session'),
  catalog: () => request<PublicCatalog>('learning?catalog=1'),
  state: () => request<LearningState>('learning'),
  class: (key: string) => request<ClassDocument>(`learning?classKey=${encodeURIComponent(key)}`),
  login: (displayName: string) => request<Session>('dev-session', { method: 'POST', body: JSON.stringify({ displayName }) }),
  logout: () => request<unknown>('session', { method: 'DELETE' }),
  action: (action: LearningAction, expectedUserId: string) => request<ActionResponse>('learning', {
    method: 'POST', body: JSON.stringify(action), headers: { 'X-Learning-User-Id': expectedUserId },
  }),
};
