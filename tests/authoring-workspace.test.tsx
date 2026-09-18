// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from './render';
import { AuthoringWorkspace } from '@/features/authoring/authoring-workspace';
import type { AuthoringAction, AuthoringWorkspace as Workspace, DraftDetail, DraftEdit } from '@/shared/authoring';

const workspace: Workspace = {
  role: 'admin',
  drafts: [],
  courses: [{ key: 'fractions', title: '분수', summary: '분수를 처음부터' }],
  lessons: [{ lessonKey: 'fraction-meaning', courseKey: 'fractions', title: '분수의 의미', latestVersionId: null, suggestedVersionId: 'fraction-meaning:v3', hasDraft: true }],
  accounts: [],
  concepts: [{ key: 'term.denominator', label: '분모', assessable: true }],
  expertMode: false,
};
const problemId = 'fraction-meaning:practice:p1:v3';
const edit = (withProblem = false): DraftEdit => ({
  meta: { versionId: 'fraction-meaning:v3', title: '분수의 의미', summary: '분수를 읽는 법', estimatedMinutes: 10, conceptKeys: ['term.denominator'] },
  sections: [
    { sectionId: 'fraction-meaning:explanation:v3', role: 'explanation', title: '분수는 무엇인가', contentBlocks: [] },
    ...(withProblem ? [{
      sectionId: 'fraction-meaning:practice:v3', role: 'practice' as const, title: '직접 해보기',
      contentBlocks: [{ blockId: 'fraction-meaning:practice:set:v3', kind: 'core.problem_set', typeVersion: 2, required: true, payload: { problemVersionIds: [problemId] } }],
    }] : []),
  ],
  problems: withProblem ? [{
    problemVersionId: problemId, conceptKeys: ['term.denominator'],
    promptContent: [{ blockId: 'fraction-meaning:practice:p1:prompt:v3', kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: '분모는 얼마인가요?' } }],
    gradingSpec: { kind: 'integer', value: 4 }, hints: [], solution: [],
  }] : [],
});
const detail = (withProblem = false): DraftDetail => ({
  id: 'd1', lessonKey: 'fraction-meaning', versionId: 'fraction-meaning:v3', baseVersionId: null, title: '분수의 의미',
  status: 'draft', publishedVersionId: null, updatedAt: '2026-09-18T00:00:00.000Z', authorName: '선생님', mine: true,
  edit: edit(withProblem), definitions: [], glossary: [], issues: [], review: null,
});

/**
 * The real API client, answered by a stand-in server. Mocking the client module would test the
 * screen against a description of the server; answering `fetch` tests it against one, and lets a
 * test say what the server did — restated the draft, refused the save — rather than what it returns.
 */
function serve(withProblem = false) {
  const sent: AuthoringAction[] = [];
  const state = { draft: detail(withProblem), refuseSaves: 0, restate: undefined as ((sent: DraftEdit) => DraftEdit) | undefined };
  const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/v1/session')) return reply({ user: { id: 'u1', displayName: '선생님' }, developmentLogin: false, googleLogin: true });
    if (url.includes('/api/v1/authoring?draftId=')) return reply({ draft: state.draft });
    if (url.endsWith('/api/v1/authoring') && init?.method !== 'POST') return reply({ workspace });
    if (url.endsWith('/api/v1/authoring')) {
      const action = JSON.parse(String(init!.body)) as AuthoringAction;
      sent.push(action);
      if (action.action === 'draft.save') {
        if (state.refuseSaves > 0) { state.refuseSaves -= 1; return reply({ error: { code: 'SAVE_FAILED', message: '저장하지 못했어요. 입력 형식을 확인해 주세요.' } }, 500); }
        const stored = state.restate ? state.restate(action.edit) : action.edit;
        state.draft = { ...state.draft, edit: stored };
        return reply({ workspace, draft: state.draft });
      }
      return reply({ workspace });
    }
    throw new Error(`아무도 답하지 않는 요청: ${url}`);
  }) as typeof fetch;
  return { sent, state, saves: () => sent.filter((action) => action.action === 'draft.save') };
}

/** Lets time pass for the screen: timers first, then the promises they started. */
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
/** `waitFor` polls on the timers this file has taken over, so waiting is done by hand. */
const until = async (check: () => void, tries = 40) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try { check(); return; } catch { await tick(1); }
  }
  check();
};
const openEditor = async () => {
  window.history.replaceState({}, '', '/authoring?draft=d1');
  render(<AuthoringWorkspace />);
  await until(() => expect(screen.getByLabelText('단계 제목')).toBeDefined());
};
const status = () => document.querySelector('.editor-bar .pill')!.textContent;
const write = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const lastSaved = (server: ReturnType<typeof serve>) =>
  (server.saves().at(-1) as { edit: DraftEdit } | undefined)?.edit;

let server: ReturnType<typeof serve>;
beforeEach(() => { vi.useFakeTimers(); server = serve(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('writing is saved without being asked', () => {
  it('writes what is on the screen after the typing stops', async () => {
    await openEditor();
    expect(status()).toBe('저장됨');
    write('단계 제목', '분수를 읽는 법');
    expect(status()).toBe('곧 저장해요');
    expect(server.saves()).toHaveLength(0);
    await tick(1500);
    expect(lastSaved(server)?.sections[0].title).toBe('분수를 읽는 법');
    expect(status()).toBe('저장됨');
  });

  it('folds a run of keystrokes into one save', async () => {
    await openEditor();
    write('단계 제목', '분');
    await tick(600);
    write('단계 제목', '분수');
    await tick(600);
    write('단계 제목', '분수를 읽는 법');
    await tick(1500);
    expect(server.saves()).toHaveLength(1);
    expect(lastSaved(server)?.sections[0].title).toBe('분수를 읽는 법');
  });

  it('writes at once when asked with ⌘S, without waiting out the pause', async () => {
    await openEditor();
    write('단계 제목', '분수를 읽는 법');
    await act(async () => { fireEvent.keyDown(window, { key: 's', metaKey: true }); });
    await tick();
    expect(server.saves()).toHaveLength(1);
  });
});

describe('a save the server refused', () => {
  it('says so and tries again on its own', async () => {
    await openEditor();
    server.state.refuseSaves = 1;
    write('단계 제목', '분수를 읽는 법');
    await tick(1500);
    expect(status()).toBe('저장하지 못했어요');
    expect(screen.getByRole('alert').textContent).toContain('입력 형식을 확인해 주세요');
    // The retry waits longer than the pause after a keystroke, so it does not hammer a failing server.
    await tick(1500);
    expect(server.saves()).toHaveLength(1);
    await tick(8000);
    expect(server.saves()).toHaveLength(2);
    expect(status()).toBe('저장됨');
  });
});

describe('an answer the editor cannot read', () => {
  const answerBox = () => screen.getByPlaceholderText('예: -3, 2.5, 1/4') as HTMLInputElement;
  const openProblem = async () => {
    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: /직접 해보기/ }));
    await until(() => expect(screen.getByRole('button', { name: '1번 문항' })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '1번 문항' }));
    await until(() => expect(answerBox()).toBeDefined());
  };

  it('holds the save back until the answer can be read again', async () => {
    server = serve(true);
    await openProblem();
    // Something real to save, so what follows is the answer holding it back and nothing else.
    write('단계 제목', '직접 해보기 · 고침');
    expect(status()).toBe('곧 저장해요');
    fireEvent.change(answerBox(), { target: { value: 'abc' } });
    expect(status()).toBe('정답 입력 확인 필요');
    await tick(1500);
    expect(server.saves()).toHaveLength(0);
    // The question is named, not just counted, so the author can go straight to it.
    expect(screen.getByText(/정답을 확인할 문항/)).toBeDefined();
    fireEvent.change(answerBox(), { target: { value: '5' } });
    await tick(1500);
    expect(server.saves()).toHaveLength(1);
    expect(status()).toBe('저장됨');
  });

  it('refuses an immediate ⌘S too, and says why', async () => {
    server = serve(true);
    await openProblem();
    write('단계 제목', '직접 해보기 · 고침');
    fireEvent.change(answerBox(), { target: { value: 'abc' } });
    await act(async () => { fireEvent.keyDown(window, { key: 's', metaKey: true }); });
    await tick();
    expect(server.saves()).toHaveLength(0);
    // Two things speak up here — the banner and the list of questions — so this names the banner.
    expect(screen.getByText(/정답 입력을 확인해 주세요/)).toBeDefined();
  });
});

describe('what the server says back', () => {
  it('adopts the server\'s restatement when nothing moved since the save left', async () => {
    server.state.restate = (sent) => ({ ...sent, sections: [{ ...sent.sections[0], title: sent.sections[0].title.trim() }] });
    await openEditor();
    write('단계 제목', '  분수를 읽는 법  ');
    await tick(1500);
    expect((screen.getByLabelText('단계 제목') as HTMLTextAreaElement).value).toBe('분수를 읽는 법');
    expect(status()).toBe('저장됨');
  });

  /** The restatement is a moment old. Taking it after the author has moved on would throw away
   *  the sentence they were in the middle of. */
  it('leaves the author\'s newer writing alone', async () => {
    let release: (() => void) | null = null;
    server.state.restate = (sent) => ({ ...sent, sections: [{ ...sent.sections[0], title: '서버가 고친 제목' }] });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const isSave = init?.method === 'POST' && String(init.body).includes('draft.save');
      if (!isSave) return realFetch(input, init);
      await new Promise<void>((resolve) => { release = resolve; });
      return realFetch(input, init);
    }) as typeof fetch;

    await openEditor();
    write('단계 제목', '먼저 쓴 것');
    await tick(1500);
    // The save is in flight; the author keeps writing.
    write('단계 제목', '그 뒤에 쓴 것');
    await act(async () => { release!(); await vi.advanceTimersByTimeAsync(0); });
    expect((screen.getByLabelText('단계 제목') as HTMLTextAreaElement).value).toBe('그 뒤에 쓴 것');
  });
});

describe('leaving with writing the server has not been told', () => {
  it('lets the browser ask first, and stops asking once it is written', async () => {
    await openEditor();
    const ask = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(ask()).toBe(false);
    write('단계 제목', '분수를 읽는 법');
    expect(ask()).toBe(true);
    await tick(1500);
    expect(ask()).toBe(false);
  });
});

describe('taking a step back', () => {
  it('undoes and redoes a step the author took', async () => {
    await openEditor();
    const undo = screen.getByRole('button', { name: '되돌리기' });
    const redo = screen.getByRole('button', { name: '다시 실행' });
    expect(undo.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /단계 추가/ }));
    expect(screen.getAllByText('새 단계').length).toBeGreaterThan(0);
    expect(undo.hasAttribute('disabled')).toBe(false);
    fireEvent.click(undo);
    expect(screen.queryByText('새 단계')).toBeNull();
    fireEvent.click(redo);
    expect(screen.getAllByText('새 단계').length).toBeGreaterThan(0);
    await tick(1500);
  });

  it('answers ⌘Z and ⇧⌘Z the same way', async () => {
    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: /단계 추가/ }));
    expect(screen.getAllByText('새 단계').length).toBeGreaterThan(0);
    await act(async () => { fireEvent.keyDown(window, { key: 'z', metaKey: true }); });
    expect(screen.queryByText('새 단계')).toBeNull();
    await act(async () => { fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true }); });
    expect(screen.getAllByText('새 단계').length).toBeGreaterThan(0);
    await tick(1500);
  });
});
