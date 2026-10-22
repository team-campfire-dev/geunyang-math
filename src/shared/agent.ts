/**
 * The codes an author gives an AI so it can write lessons as them. The screen that makes them and the
 * route an AI calls share these names; the code itself is only ever seen by the screen once.
 */

/** Every code starts with this, so one pasted somewhere it should not be is recognisable for what it is. */
export const agentCodePrefix = 'gmk_';
export const agentCodePattern = /^gmk_[a-f0-9]{64}$/;
/** How long a code may live. Short by default: a code is handed to a conversation, not to a person. */
export const agentKeyDays = [1, 7, 30, 90] as const;
export type AgentKeyDays = (typeof agentKeyDays)[number];
export const agentKeyLimits = { maxPerAccount: 10, maxName: 80 };

export type AgentKeyView = {
  id: string; name: string;
  /** The code's first characters, which is all that is kept of it besides its hash. */
  hint: string;
  mayPublish: boolean;
  expiresAt: string; lastUsedAt: string | null; createdAt: string;
};

export type AgentKeyAction =
  | { action: 'key.issue'; name: string; days: AgentKeyDays; mayPublish: boolean }
  | { action: 'key.revoke'; keyId: string };

export type AgentKeysView = {
  keys: AgentKeyView[];
  /** Whether this account may give a key the right to publish: only one that may publish itself. */
  mayPublish: boolean;
};

/** A key just made, with the code that will not be shown again. */
export type AgentKeyResponse = { view: AgentKeysView; issued?: { key: AgentKeyView; code: string } };

/**
 * What to paste into a conversation with an AI along with the code: where to call and how to begin.
 * The AI reads the rest from the guide the route returns, so this stays short and never goes stale.
 */
export function agentInstructions(origin: string, code: string): string {
  return [
    '「그냥수학」의 수업을 편집해 줘. 아래 주소와 코드로 편집 API를 쓸 수 있어.',
    '',
    `API: ${origin}/api/v1/agent`,
    `코드: ${code}`,
    '',
    '모든 요청에 `Authorization: Bearer <코드>` 헤더를 붙여.',
    `먼저 \`GET ${origin}/api/v1/agent\`로 안내(쓸 수 있는 동작, 블록 형식, 작성 지침)를 읽고 그대로 따라.`,
    '코드는 다른 곳에 옮기거나 출력하지 마.',
  ].join('\n');
}
