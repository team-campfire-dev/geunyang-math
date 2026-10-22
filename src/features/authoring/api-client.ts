import { apiRequest } from '@/features/api-client';
import type { AuthoringAction, AuthoringResponse, AuthoringWorkspace, DraftDetail } from '@/shared/authoring';
import type { TeachingAction, TeachingResponse, TeachingView } from '@/shared/teaching';
import type { AiUsageView } from '@/shared/ai-usage';
import type { AgentKeyAction, AgentKeyResponse, AgentKeysView } from '@/shared/agent';
import type { FeedbackAction, FeedbackInbox, LessonFeedbackView } from '@/shared/feedback';

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

/** What models cost, for the operator. */
export const aiUsageApi = {
  view: () => apiRequest<{ usage: AiUsageView }>('ai-usage'),
};

/** The codes this account gives an AI to write lessons with. */
export const agentKeysApi = {
  view: () => apiRequest<{ view: AgentKeysView }>('agent-keys'),
  act: (action: AgentKeyAction, expectedUserId: string) => apiRequest<AgentKeyResponse>('agent-keys', {
    method: 'POST', body: JSON.stringify(action), headers: { 'X-Agent-Keys-User-Id': expectedUserId },
  }),
};

/** What readers said about lessons, for the operator. */
export const feedbackApi = {
  inbox: () => apiRequest<{ inbox: FeedbackInbox }>('feedback'),
  act: (action: FeedbackAction, expectedUserId: string) => apiRequest<{ feedback: LessonFeedbackView }>('feedback', {
    method: 'POST', body: JSON.stringify(action), headers: { 'X-Feedback-User-Id': expectedUserId },
  }),
};
