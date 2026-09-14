/** Browser-only navigation metadata. Authentication credentials never enter storage. */
export const AUTH_RETURN_STORAGE_KEY = 'geunyang-math:google-return:v1';
export const AUTH_RETURN_MAX_AGE_MS = 30 * 60 * 1000;
export const GOOGLE_LOGIN_PATH = '/api/auth/google/start';

const authMessages = {
  cancelled: 'Google 로그인을 취소했어요. 준비되면 다시 시작해 주세요.',
  expired: '로그인 시간이 지나 연결을 마치지 못했어요. Google로 다시 계속해 주세요.',
  unavailable: '지금은 Google에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.',
  failed: 'Google 로그인을 완료하지 못했어요. 다시 시도해 주세요.',
};

export function parseAuthError(search: string): { message: string; cleanSearch: string } | null {
  const parameters = new URLSearchParams(search);
  if (!parameters.has('authError')) return null;
  const code = parameters.get('authError') ?? '';
  const message = Object.hasOwn(authMessages, code) ? authMessages[code as keyof typeof authMessages] : authMessages.failed;
  parameters.delete('authError');
  const remaining = parameters.toString();
  return { message, cleanSearch: remaining ? `?${remaining}` : '' };
}

export function canUseWebAuthentication(apiOrigin: string, browserOrigin: string, nativePlatform: boolean): boolean {
  if (nativePlatform) return false;
  try {
    const browser = new URL(browserOrigin);
    const api = new URL(apiOrigin || browser.origin);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(browser.hostname);
    return (browser.protocol === 'https:' || (browser.protocol === 'http:' && loopback))
      && api.origin === browser.origin && api.pathname === '/' && !api.search && !api.hash
      && !api.username && !api.password;
  } catch { return false; }
}

export type AuthReturn = { classKey: string; createdAt: number };
export function parseAuthReturn(value: string | null, now: number): AuthReturn | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const entry = parsed as Record<string, unknown>;
    if (typeof entry.classKey !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,190}$/i.test(entry.classKey)) return null;
    if (typeof entry.createdAt !== 'number' || !Number.isFinite(entry.createdAt) || entry.createdAt > now || now - entry.createdAt > AUTH_RETURN_MAX_AGE_MS) return null;
    return { classKey: entry.classKey, createdAt: entry.createdAt };
  } catch { return null; }
}

export function readAuthReturn(storage: Pick<Storage, 'getItem' | 'removeItem'>, now = Date.now()): AuthReturn | null {
  try {
    const entry = parseAuthReturn(storage.getItem(AUTH_RETURN_STORAGE_KEY), now);
    if (!entry) storage.removeItem(AUTH_RETURN_STORAGE_KEY);
    return entry;
  } catch { return null; }
}

export function clearAuthReturn(storage: Pick<Storage, 'removeItem'>): void {
  try { storage.removeItem(AUTH_RETURN_STORAGE_KEY); } catch { /* Storage restrictions must not block authentication. */ }
}

export function saveAuthReturn(storage: Pick<Storage, 'setItem' | 'removeItem'>, classKey: string | null, now = Date.now()): void {
  try {
    const entry = classKey ? parseAuthReturn(JSON.stringify({ classKey, createdAt: now }), now) : null;
    if (entry) storage.setItem(AUTH_RETURN_STORAGE_KEY, JSON.stringify(entry));
    else storage.removeItem(AUTH_RETURN_STORAGE_KEY);
  } catch { /* Returning to the dashboard is safe when browser storage is unavailable. */ }
}

export function isNativeBrowser(bridge?: { isNativePlatform?: () => boolean; getPlatform?: () => string }): boolean {
  try {
    if (bridge?.isNativePlatform) return bridge.isNativePlatform();
    if (bridge?.getPlatform) return bridge.getPlatform() !== 'web';
    return false;
  } catch { return true; }
}

export type LearningAccountSnapshot = { userId: string | null; generation: number };
export class LearningResponseError extends Error {
  constructor(readonly kind: 'stale' | 'account-changed') {
    super(kind === 'stale' ? '학습 공간을 새로 불러오고 있어요.' : '로그인 계정이 바뀌었어요. 화면을 새로 불러온 뒤 다시 시도해 주세요.');
    this.name = 'LearningResponseError';
  }
}

/** Check staleness first: an old response must never clear a newer account's state. */
export function assertLearningResponseAccount(request: LearningAccountSnapshot, current: LearningAccountSnapshot, responseUserId: string | null): void {
  if (request.generation !== current.generation || request.userId !== current.userId) throw new LearningResponseError('stale');
  if (responseUserId !== request.userId) throw new LearningResponseError('account-changed');
}
