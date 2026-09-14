import { describe, expect, it } from 'vitest';
import { AUTH_RETURN_MAX_AGE_MS, AUTH_RETURN_STORAGE_KEY, canUseWebAuthentication, clearAuthReturn, isNativeBrowser, parseAuthError, parseAuthReturn, readAuthReturn, saveAuthReturn } from '@/features/learning/auth-client';

describe('web-only authentication boundary', () => {
  it('allows a same-origin HTTPS web app and explicit loopback development', () => {
    expect(canUseWebAuthentication('', 'https://math.example.com', false)).toBe(true);
    expect(canUseWebAuthentication('https://math.example.com/', 'https://math.example.com', false)).toBe(true);
    expect(canUseWebAuthentication('', 'http://127.0.0.1:3017', false)).toBe(true);
  });

  it.each([
    ['https://api.example.com', 'https://math.example.com', false],
    ['https://math.example.com', 'capacitor://localhost', true],
    ['', 'https://math.example.com', true],
    ['', 'http://math.example.com', false],
    ['https://math.example.com/api', 'https://math.example.com', false],
    ['https://user:password@math.example.com', 'https://math.example.com', false],
    ['https://math.example.com/?returnTo=https://evil.example', 'https://math.example.com', false],
  ] as const)('does not offer cookie OAuth for an unsupported transport: %s / %s', (api, origin, native) => {
    expect(canUseWebAuthentication(api, origin, native)).toBe(false);
  });

  it('recognizes native bridges and fails closed when platform detection fails', () => {
    expect(isNativeBrowser()).toBe(false);
    expect(isNativeBrowser({ isNativePlatform: () => true })).toBe(true);
    expect(isNativeBrowser({ getPlatform: () => 'ios' })).toBe(true);
    expect(isNativeBrowser({ getPlatform: () => 'web' })).toBe(false);
    expect(isNativeBrowser({ isNativePlatform: () => { throw new Error('bridge unavailable'); } })).toBe(true);
  });
});

describe('safe OAuth callback messages', () => {
  it('consumes only its own error parameter and preserves unrelated navigation metadata', () => {
    const result = parseAuthError('?lesson=fraction-meaning&authError=expired&view=preview&authError=failed');
    expect(result?.message).toContain('로그인 시간이 지나');
    expect(result?.cleanSearch).toBe('?lesson=fraction-meaning&view=preview');
    expect(parseAuthError('?view=preview')).toBeNull();
  });

  it.each(['cancelled', 'expired', 'unavailable', 'failed'])('provides a localized retry message for %s', (code) => {
    expect(parseAuthError(`?authError=${code}`)?.message).toMatch(/[가-힣]/);
    expect(parseAuthError(`?authError=${code}`)?.cleanSearch).toBe('');
  });

  it('never reflects unknown provider text or treats it as a redirect', () => {
    const result = parseAuthError(`?authError=${encodeURIComponent('<script>https://evil.example</script>')}`);
    expect(result?.message).toBe('Google 로그인을 완료하지 못했어요. 다시 시도해 주세요.');
    expect(result?.cleanSearch).toBe('');
    expect(parseAuthError('?authError=__proto__')?.message).toBe(result?.message);
  });
});

describe('optional class return metadata', () => {
  const now = 1_000_000_000;

  it('retains only a class key and timestamp, never credential-shaped extra values', () => {
    const result = parseAuthReturn(JSON.stringify({ classKey: 'fraction-meaning', createdAt: now, accessToken: 'not-to-be-retained' }), now);
    expect(result).toEqual({ classKey: 'fraction-meaning', createdAt: now });
  });

  it.each(['https://evil.example', '//evil.example', '../class', 'fraction?redirect=evil', '<script>'])('rejects URL-like or invalid class return values: %s', (classKey) => {
    expect(parseAuthReturn(JSON.stringify({ classKey, createdAt: now }), now)).toBeNull();
  });

  it('expires abandoned login navigation and rejects malformed or future entries', () => {
    expect(parseAuthReturn('{broken', now)).toBeNull();
    expect(parseAuthReturn(JSON.stringify({ classKey: 'fraction-meaning', createdAt: now - AUTH_RETURN_MAX_AGE_MS - 1 }), now)).toBeNull();
    expect(parseAuthReturn(JSON.stringify({ classKey: 'fraction-meaning', createdAt: now + 1 }), now)).toBeNull();
  });

  it('stores only this app’s navigation entry and clears it on logout', () => {
    const data = new Map<string, string>([['another-app', 'preserve']]);
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
    saveAuthReturn(storage, 'fraction-meaning', now);
    expect(readAuthReturn(storage, now)).toEqual({ classKey: 'fraction-meaning', createdAt: now });
    expect(data.get(AUTH_RETURN_STORAGE_KEY)).toBe(JSON.stringify({ classKey: 'fraction-meaning', createdAt: now }));
    clearAuthReturn(storage);
    expect(data.has(AUTH_RETURN_STORAGE_KEY)).toBe(false);
    expect(data.get('another-app')).toBe('preserve');
  });

  it('still permits login when browser storage is unavailable', () => {
    const fail = () => { throw new Error('storage disabled'); };
    const storage = { getItem: fail, setItem: fail, removeItem: fail };
    expect(() => saveAuthReturn(storage, 'fraction-meaning', now)).not.toThrow();
    expect(readAuthReturn(storage, now)).toBeNull();
    expect(() => clearAuthReturn(storage)).not.toThrow();
  });
});
