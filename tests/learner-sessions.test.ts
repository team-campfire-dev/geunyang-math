import { describe, expect, it } from 'vitest';
import { clientKind } from '@/server/learner-visits';
import { cutSittings, notesOf, promptLine, type Built, type EnrollmentFacts } from '@/server/learner-sessions';
import { clientLabel, type ClientKind, type SittingEvent } from '@/shared/learner-sessions';

/** Instagram's own browser on a Galaxy, as the first middle-school learner opened a link sent in a DM. */
const instagram = 'Mozilla/5.0 (Linux; Android 16; SM-S931N Build/BP4A.251205.006; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.8059.73 Mobile Safari/537.36 Instagram 451.0.0.53.80 Android (36/16; 420dpi; 1080x2340; samsung; SM-S931N; pa1q; qcom; ko_KR; 1089931504; IABMV/1)';

describe('what a browser is, kept as kinds', () => {
  it('names an app’s own browser, which is where a login quietly stops', () => {
    expect(clientKind(instagram)).toEqual({ device: 'phone', os: 'android', browser: 'chrome', inApp: 'instagram' });
    expect(clientLabel(clientKind(instagram))).toBe('안드로이드 폰 · 인스타그램 앱 안 브라우저');
    expect(clientKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0').inApp).toBe('kakaotalk');
    // An app Android marks but nothing here knows by name is still an app's browser.
    expect(clientKind('Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0 Mobile Safari/537.36').inApp).toBe('webview');
  });

  it('tells ordinary browsers and devices apart', () => {
    expect(clientKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'))
      .toEqual({ device: 'phone', os: 'ios', browser: 'safari', inApp: null });
    expect(clientKind('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Safari/537.36'))
      .toEqual({ device: 'tablet', os: 'android', browser: 'samsung', inApp: null });
    expect(clientKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'))
      .toEqual({ device: 'desktop', os: 'macos', browser: 'chrome', inApp: null });
    expect(clientKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0').browser).toBe('edge');
    expect(clientKind(null)).toEqual({ device: 'unknown', os: 'other', browser: 'other', inApp: null });
  });
});

describe('a question named in a line', () => {
  it('drops the marks that set mathematics and keeps it short', () => {
    expect(promptLine({ text: '닮음비가 $2:3$인 두 삼각형에서 작은 쪽의 한 변이 $4$일 때 대응하는 변의 길이를 써 주세요.' }))
      .toBe('닮음비가 2:3인 두 삼각형에서 작은 쪽의 한 변이 4일 때 대응하는 변의 길이를 써 주세요.');
    expect(promptLine({ text: '$\\triangle ABC$와 $\\overline{AB} = 6$' })).toBe('ABC와 AB = 6');
    expect(promptLine({ text: '가'.repeat(100) })).toHaveLength(80);
    expect(promptLine(null)).toBe('');
  });
});

const at = (clock: string) => new Date(`2026-10-24T${clock}Z`);
const phone: ClientKind = clientKind(instagram);
const visit = (clock: string, kind: 'login' | 'open' | 'return' | 'logout', sessionId = 's1'): Built =>
  ({ at: at(clock), learner: true, sessionId, event: { kind: 'visit', at: at(clock).toISOString(), visit: kind, client: phone } });
/** An event before its time is written on it — every kind of one, which a plain `Omit` of the union would not allow. */
type Unstamped = SittingEvent extends infer E ? E extends SittingEvent ? Omit<E, 'at'> : never : never;
const of = (clock: string, event: Unstamped, extra: Partial<Built> = {}): Built =>
  ({ at: at(clock), learner: true, event: { ...event, at: at(clock).toISOString() } as SittingEvent, ...extra });
const section = (clock: string, sectionTitle: string, role: string, position: number) =>
  of(clock, { kind: 'section', lessonTitle: '닮음', sectionTitle, role, position, of: 5, seconds: null }, { enrollmentId: 'e1' });
const answer = (clock: string, status: 'correct' | 'incorrect', question = 'q1', attempt = 1) =>
  of(clock, { kind: 'answer', prompt: '닮음비가 2:3일 때', answer: '6', status, hint: false, where: '닮음', attempt, seconds: null }, { enrollmentId: 'e1', question });

describe('sittings, cut where nothing was done for half an hour', () => {
  it('keeps a break inside one, and starts another after the gap', () => {
    const groups = cutSittings([visit('15:52:22', 'login'), visit('16:20:00', 'open'), visit('17:00:00', 'open')]);
    expect(groups.map((group) => group.length)).toEqual([2, 1]);
  });
});

describe('what a sitting says when read through', () => {
  const facts = new Map<string, EnrollmentFacts>([['e1', { id: 'e1', lessonTitle: '닮음', sections: 5, completedAt: null, finishedAt: [at('15:56:55'), at('15:56:58')] }]]);
  const read = (events: Built[], visits = events.filter((item) => item.event.kind === 'visit')) => {
    const [group] = cutSittings(events);
    // The seconds are put in as the service does it, inside the sitting.
    let mark: Date | null = null;
    for (const item of group) if (item.event.kind === 'section') { item.event.seconds = mark ? Math.round((item.at.getTime() - mark.getTime()) / 1000) : null; mark = item.at; }
    return notesOf(group, visits, facts).map((note) => note.kind);
  };

  it('reads the first learner’s night: an app’s browser, a step passed in seconds, a page opened from the top again and again', () => {
    const notes = read([visit('15:52:22', 'login'), visit('15:52:57', 'open'), visit('15:54:45', 'open'),
      of('15:55:20', { kind: 'lesson', phase: 'start', lessonTitle: '닮음', courseTitle: '도형의 닮음' }, { enrollmentId: 'e1' }),
      section('15:56:55', '개념 만나기', 'explanation', 1), section('15:56:58', '함께 풀어 보기', 'worked_example', 2), visit('15:57:50', 'open')]);
    expect(notes).toEqual(['in-app', 'reopened', 'skimmed', 'stopped']);
  });

  it('says so when somebody logs in again without having logged out', () => {
    const earlier = [visit('10:00:00', 'login', 's0'), visit('10:05:00', 'open', 's0')];
    const later = [visit('16:07:52', 'login', 's1')];
    expect(read(later, [...earlier, ...later])).toContain('relogin');
    // Having logged out first, logging in again is just logging in.
    const out = [...earlier, visit('10:10:00', 'logout', 's0'), ...later];
    expect(read(later, out)).not.toContain('relogin');
  });

  it('counts a question missed twice, and praises a clean run only when it is one', () => {
    expect(read([answer('16:01:00', 'incorrect'), answer('16:01:30', 'incorrect', 'q1', 2), answer('16:02:00', 'correct', 'q1', 3)])).toContain('struggled');
    expect(read([answer('16:01:00', 'correct', 'q1'), answer('16:01:30', 'correct', 'q2'), answer('16:02:00', 'correct', 'q3')])).toContain('clean');
    expect(read([answer('16:01:00', 'correct', 'q1'), answer('16:01:30', 'correct', 'q2'), answer('16:02:00', 'correct', 'q3', 2)])).not.toContain('clean');
  });
});
