// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import { AgentKeyPanel } from '@/features/authoring/agent-key-panel';
import type { AgentKeyResponse, AgentKeysView, AgentKeyView } from '@/shared/agent';

const code = `gmk_${'ab'.repeat(32)}`;
const key: AgentKeyView = { id: 'k1', name: 'Claude', hint: 'gmk_ababab', mayPublish: false,
  expiresAt: '2026-10-29T00:00:00.000Z', lastUsedAt: null, createdAt: '2026-10-22T00:00:00.000Z' };
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('the codes an author gives an AI', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a new code once, inside the words to paste, and takes it off the screen when it is revoked', async () => {
    const empty: AgentKeysView = { keys: [], mayPublish: false };
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.body) return reply({ view: empty });
      const action = JSON.parse(String(init.body));
      return reply(action.action === 'key.issue'
        ? { view: { keys: [key], mayPublish: false }, issued: { key, code } } satisfies AgentKeyResponse
        : { view: empty } satisfies AgentKeyResponse);
    });
    vi.stubGlobal('fetch', fetch);
    render(<AgentKeyPanel userId="u1" />);
    await waitFor(() => expect(screen.getByText('아직 건넨 코드가 없어요.')).toBeTruthy());
    // An account that does not publish is not offered a code that does.
    expect(screen.queryByText('발행도 맡기기')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/Claude/), { target: { value: 'Claude' } });
    fireEvent.click(screen.getByRole('button', { name: '코드 만들기' }));
    const words = await screen.findByLabelText('AI에게 건넬 안내와 코드') as HTMLTextAreaElement;
    expect(words.value).toContain(code);
    expect(words.value).toContain('/api/v1/agent');
    expect(JSON.parse(String(fetch.mock.calls[1][1]!.body))).toEqual({ action: 'key.issue', name: 'Claude', days: 7, mayPublish: false });
    expect(screen.getByText('gmk_ababab…')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /거두기/ }));
    await waitFor(() => expect(screen.queryByLabelText('AI에게 건넬 안내와 코드')).toBeNull());
    expect(screen.getByText('아직 건넨 코드가 없어요.')).toBeTruthy();
  });

  it('offers publishing only to an account that publishes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ view: { keys: [{ ...key, mayPublish: true }], mayPublish: true } })));
    render(<AgentKeyPanel userId="u1" />);
    await waitFor(() => expect(screen.getByText('발행도 맡기기')).toBeTruthy());
    expect(screen.getByText(/^발행까지 ·/)).toBeTruthy();
  });
});
