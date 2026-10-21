import { apiRequest } from '@/features/api-client';
import type { AuthoringAction, AuthoringResponse, AuthoringWorkspace, DraftDetail } from '@/shared/authoring';
import type { TeachingAction, TeachingResponse, TeachingView } from '@/shared/teaching';

export const authoringApi = {
  workspace: () => apiRequest<{ workspace: AuthoringWorkspace }>('authoring'),
  draft: (draftId: string) => apiRequest<{ draft: DraftDetail }>(`authoring?draftId=${encodeURIComponent(draftId)}`),
  act: (action: AuthoringAction, expectedUserId: string) => apiRequest<AuthoringResponse>('authoring', {
    method: 'POST', body: JSON.stringify(action), headers: { 'X-Authoring-User-Id': expectedUserId },
  }),
};

/** The teaching side: who this account teaches, and the courses set for them. */
export const teachingApi = {
  view: () => apiRequest<{ teaching: TeachingView }>('teaching'),
  act: (action: TeachingAction, expectedUserId: string) => apiRequest<TeachingResponse>('teaching', {
    method: 'POST', body: JSON.stringify(action), headers: { 'X-Teaching-User-Id': expectedUserId },
  }),
};
