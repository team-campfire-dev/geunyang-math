import { apiRequest } from '@/features/api-client';
import type { AuthoringAction, AuthoringResponse, AuthoringWorkspace, DraftDetail } from '@/shared/authoring';

export const authoringApi = {
  workspace: () => apiRequest<{ workspace: AuthoringWorkspace }>('authoring'),
  draft: (draftId: string) => apiRequest<{ draft: DraftDetail }>(`authoring?draftId=${encodeURIComponent(draftId)}`),
  act: (action: AuthoringAction, expectedUserId: string) => apiRequest<AuthoringResponse>('authoring', {
    method: 'POST', body: JSON.stringify(action), headers: { 'X-Authoring-User-Id': expectedUserId },
  }),
};
