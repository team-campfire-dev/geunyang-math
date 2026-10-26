// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import { LearnerSessionsPanel, lasting } from '@/features/authoring/learner-sessions-panel';
import type { ClientKind, LearnerSessionsDetail, LearnerSessionsList } from '@/shared/learner-sessions';

const phone: ClientKind = { device: 'phone', os: 'android', browser: 'chrome', inApp: 'instagram' };
const learner = { userId: 'u1', displayName: '가상 학습자', joinedAt: '2026-10-24T15:52:22.000Z', lastActiveAt: '2026-10-24T16:05:35.000Z',
  recentSittings: 1, lessonsCompleted: 1, answers: 2, lastClient: phone };
const list: LearnerSessionsList = { learners: [learner, { ...learner, userId: 'u2', displayName: '한 번도 안 한 사람', lastActiveAt: null, recentSittings: 0, lessonsCompleted: 0, answers: 0, lastClient: null }] };
const detail: LearnerSessionsDetail = { learner, sittings: [
  { startedAt: '2026-10-24T15:52:22.000Z', endedAt: '2026-10-24T16:05:35.000Z', learnerActive: true, clients: [phone],
    notes: [{ kind: 'in-app', text: '인스타그램 앱 안 브라우저로 들어왔어요. 앱 안 브라우저에서는 로그인이 풀리기 쉬워요.' }, { kind: 'skimmed', text: '「함께 풀어 보기」를 3초 만에 넘겼어요.' }],
    events: [
      { kind: 'visit', at: '2026-10-24T15:52:22.000Z', visit: 'login', client: phone },
      { kind: 'lesson', at: '2026-10-24T15:55:20.000Z', phase: 'start', lessonTitle: '닮음', courseTitle: '도형의 닮음' },
      { kind: 'section', at: '2026-10-24T15:56:55.000Z', lessonTitle: '닮음', sectionTitle: '개념 만나기', role: 'explanation', position: 1, of: 5, seconds: 95 },
      { kind: 'answer', at: '2026-10-24T16:01:55.000Z', prompt: '닮음비가 2:3일 때', answer: '5', status: 'incorrect', hint: false, where: '닮음', attempt: 1, seconds: 29 },
      { kind: 'answer', at: '2026-10-24T16:02:18.000Z', prompt: '닮음비가 2:3일 때', answer: '6', status: 'correct', hint: true, where: '닮음', attempt: 2, seconds: 23 },
      { kind: 'lesson', at: '2026-10-24T16:05:35.000Z', phase: 'complete', lessonTitle: '닮음', courseTitle: '도형의 닮음' },
    ] },
  { startedAt: '2026-10-24T15:53:32.000Z', endedAt: '2026-10-24T15:53:32.000Z', learnerActive: false, clients: [], notes: [],
    events: [{ kind: 'course', at: '2026-10-24T15:53:32.000Z', courseTitle: '도형의 닮음', by: '운영자' }] },
] };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('learners’ sittings, for the operator', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists who learned lately, and opens one learner’s sittings with what they say', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => (String(input).includes('userId=u1') ? reply({ detail }) : reply({ list })));
    vi.stubGlobal('fetch', fetch);
    render(<LearnerSessionsPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: '가상 학습자' })).toBeTruthy());
    expect(screen.getAllByText('안드로이드 폰 · 인스타그램 앱 안 브라우저')).toHaveLength(1);
    expect(screen.getByText('아직 없음')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '가상 학습자' }));
    await waitFor(() => expect(screen.getByText('「함께 풀어 보기」를 3초 만에 넘겼어요.')).toBeTruthy());
    // Read in Korean time: the sitting ran from 00:52 to 01:05 on the Sunday, and lasted thirteen minutes.
    expect(screen.getByRole('heading', { level: 3, name: /10월 25일 \(일\) 00:52–01:05/ }).textContent).toContain('13분 13초');
    expect(screen.getByText(/개념 만나기/).closest('li')?.textContent).toContain('1분 35초');
    const missed = screen.getByText('틀림').closest('li')!;
    expect(missed.className).toContain('is-wrong');
    expect(screen.getByText('맞음').closest('li')?.textContent).toMatch(/2번째.*힌트 보고/);
    // What somebody else did for the learner is kept apart from the learner's own sittings.
    expect(screen.getByText('학습자 없이 있었던 일')).toBeTruthy();
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('learner-sessions?userId=u1'), expect.anything());
  });

  it('says so when the account is not an operator', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: { code: 'not_an_operator', message: '운영자만 볼 수 있어요.' } }, 403)));
    render(<LearnerSessionsPanel />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('운영자만 볼 수 있어요.'));
  });

  it('says a length of time the way it is said', () => {
    expect([3, 60, 95, 3600, 7500].map(lasting)).toEqual(['3초', '1분', '1분 35초', '1시간', '2시간 5분']);
  });
});
