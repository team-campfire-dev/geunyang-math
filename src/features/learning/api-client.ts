import type { ActionResponse, DefinitionRequest, GlossaryEntry, LessonDocument, LearningAction, LearningState, PublicCatalog } from '@/shared/api';
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
  lesson: (key: string) => request<LessonDocument>(`learning?lessonKey=${encodeURIComponent(key)}`),
  definition: (input: DefinitionRequest) => request<GlossaryEntry>('definitions', { method: 'POST', body: JSON.stringify(input) }),
  login: (displayName: string) => request<Session>('dev-session', { method: 'POST', body: JSON.stringify({ displayName }) }),
  logout: () => request<unknown>('session', { method: 'DELETE' }),
  /** Removes the account and everything kept about it. There is no undo and no id to point elsewhere. */
  deleteAccount: () => request<unknown>('account', { method: 'DELETE' }),
  action: (action: LearningAction, expectedUserId: string) => request<ActionResponse>('learning', {
    method: 'POST', body: JSON.stringify(action), headers: { 'X-Learning-User-Id': expectedUserId },
  }),
};
