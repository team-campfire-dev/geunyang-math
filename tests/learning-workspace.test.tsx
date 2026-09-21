// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from './render';
import { LearningWorkspace } from '@/features/learning/learning-workspace';
import type { AssignmentView, AttemptView, ContentBlock, LearningAction, LearningState, LessonDocument, PublicCourse, PublicLesson, PublicProblemSet } from '@/shared/api';

const lessonKey = 'fraction-meaning';
const problemId = 'fraction-meaning:practice:p1:v2';
const text = (blockId: string, value: string): ContentBlock =>
  ({ blockId, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: value } });
const laterKey = 'decimal-meaning';
/** What the practice shelf offers: named sets, in the order the lessons show them. */
const shelf: PublicProblemSet[] = [
  { problemSetId: 'fraction-meaning:practice', versionId: 'fraction-meaning:practice:v1', name: '분수의 의미 연습',
    courseKey: 'fractions', lessonKey: 'fraction-meaning', questionCount: 3, conceptKeys: ['term.denominator'] },
  { problemSetId: 'fraction-meaning:check', versionId: 'fraction-meaning:check:v1', name: '분수의 의미 확인',
    courseKey: 'fractions', lessonKey: 'fraction-meaning', questionCount: 2, conceptKeys: ['term.denominator'] },
  // A second course's set, so the shelf has two courses to hold open at once.
  { problemSetId: 'decimal-meaning:practice', versionId: 'decimal-meaning:practice:v1', name: '소수의 의미 연습',
    courseKey: 'decimals', lessonKey: 'decimal-meaning', questionCount: 4, conceptKeys: ['term.decimal'] },
];
const catalogue: PublicLesson[] = [{
  lessonKey, versionId: 'fraction-meaning:v2', title: '분수의 의미', summary: '분자와 분모를 읽어요',
  estimatedMinutes: 10, conceptKeys: ['term.denominator'], prerequisiteConceptKeys: [], sectionCount: 2, courseKey: 'fractions',
}];
/** A second course, for the screens that are about choosing between lessons rather than reading one. */
const twoCourses: PublicLesson[] = [...catalogue, {
  lessonKey: laterKey, versionId: 'decimal-meaning:v1', title: '소수의 의미', summary: '자릿값을 읽어요',
  estimatedMinutes: 10, conceptKeys: ['term.decimal'], prerequisiteConceptKeys: ['term.denominator'], sectionCount: 2, courseKey: 'decimals',
}];
const document = (blocks?: ContentBlock[]): LessonDocument => ({
  ...catalogue[0],
  sections: [
    { sectionId: 'fraction-meaning:explanation:v2', role: 'explanation', title: '분수는 무엇인가', contentBlocks: blocks ?? [text('b1', '한 덩이를 나눈 조각이에요.')] },
    { sectionId: 'fraction-meaning:practice:v2', role: 'practice', title: '직접 해보기', contentBlocks: [
      { blockId: 'set1', kind: 'core.problem_set', typeVersion: 2, required: true, payload: { problemVersionIds: [problemId] } }] },
  ],
  problems: [{ problemVersionId: problemId, conceptKeys: ['term.denominator'], promptContent: [text('p1', '분모는 얼마인가요?')], responseSpec: { kind: 'integer' }, hintAvailable: true, solutionAvailable: false }],
  glossary: [],
});
const assignment = (overrides: Partial<AssignmentView> = {}): AssignmentView => ({
  id: 'a1', recipientId: 'r1', title: '분수의 의미 복습', lessonKey, problemSetId: 'fraction-meaning:review',
  recommendedAt: '2026-09-19T00:00:00.000Z', opensAt: null, dueAt: null,
  policy: { kind: 'review', hints: true, results: 'per-item', solutions: 'never' }, status: 'assigned',
  items: [{ id: 'i1', problem: { problemVersionId: problemId, conceptKeys: ['term.denominator'], promptContent: [text('p1', '분모는 얼마인가요?')], responseSpec: { kind: 'integer' }, hintAvailable: true, solutionAvailable: false }, attempt: null, tries: 0, firstResult: null }],
  submissionId: 's1', glossary: [], ...overrides,
});
const learningState = (overrides: Partial<LearningState> = {}): LearningState => ({
  user: { id: 'u1', displayName: '학습자', targetCourseKey: null, dailyMinutes: 10 },
  lessons: catalogue, enrollments: [], assignments: [], recommendations: [],
  diagnostic: null, diagnosticOffering: null,
  plan: { version: '1', readiness: [], review: null, sessionMinutes: 10, preferredLessonKey: null },
  recommendationHistory: [], concepts: [], ...overrides,
});
const enrolled = (completedSectionIds: string[] = [], status: 'active' | 'completed' = 'active') =>
  learningState({ enrollments: [{ id: 'e1', lessonKey, lessonVersionId: 'fraction-meaning:v2', completedSectionIds, status, attempts: [] }] });

/** The real client, answered by a stand-in server, so a test can say what the server did. */
function serve(options: { signedIn?: boolean; state?: LearningState; lesson?: LessonDocument;
  courses?: PublicCourse[]; catalogue?: PublicLesson[] } = {}) {
  const sent: LearningAction[] = [];
  const state = {
    signedIn: options.signedIn ?? true,
    learning: options.state ?? learningState(),
    lesson: options.lesson ?? document(),
    refuse: null as { action: LearningAction['action']; code: string; message: string; status?: number; then?: () => void } | null,
    refuseDelete: null as { code: string; message: string } | null,
    // What the public catalogue offers. A course without a track is one an older server sent.
    courses: options.courses ?? [{ key: 'fractions', title: '분수', summary: '분수를 처음부터' }, { key: 'decimals', title: '소수', summary: '소수를 처음부터' }] as PublicCourse[],
    catalogue: options.catalogue ?? catalogue,
    deletes: 0,
    after: undefined as ((action: LearningAction) => LearningState) | undefined,
  };
  const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/v1/session')) return reply({ user: state.signedIn ? { id: 'u1', displayName: '학습자' } : null, developmentLogin: false, googleLogin: true });
    if (url.includes('/api/v1/learning?catalog=1')) return reply({ courses: state.courses, lessons: state.catalogue, concepts: [{ key: 'term.denominator', label: '분모' }], problemSets: shelf });
    if (url.includes('/api/v1/learning?lessonKey=')) return reply(state.lesson);
    if (url.endsWith('/api/v1/account') && init?.method === 'DELETE') {
      if (state.refuseDelete) return reply({ error: state.refuseDelete }, 409);
      state.deletes += 1;
      state.signedIn = false;
      return reply({ removed: { attempts: 3, enrollments: 1, assignments: 1, submissions: 1, hints: 1, diagnostics: 0, recommendations: 0 } });
    }
    if (url.endsWith('/api/v1/learning') && init?.method !== 'POST') {
      return state.signedIn ? reply(state.learning) : reply({ error: { code: 'unauthorized', message: '로그인이 필요해요.' } }, 401);
    }
    if (url.endsWith('/api/v1/learning')) {
      const action = JSON.parse(String(init!.body)) as LearningAction;
      sent.push(action);
      if (state.refuse?.action === action.action) {
        const { code, message, status, then } = state.refuse;
        then?.();
        return reply({ error: { code, message } }, status ?? 400);
      }
      if (state.after) state.learning = state.after(action);
      if (action.action === 'solution.open') return reply({ state: state.learning, solution: [text('sol1', '넷으로 나눈 한 조각이니 분모는 4예요.')] });
      return reply({ state: state.learning });
    }
    throw new Error(`아무도 답하지 않는 요청: ${url}`);
  }) as typeof fetch;
  return { sent, state, of: (name: LearningAction['action']) => sent.filter((action) => action.action === name), deletes: () => Array(state.deletes).fill(0) };
}

const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
/** `waitFor` polls on the timers this file has taken over, so waiting is done by hand. */
const until = async (check: () => void, tries = 40) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try { check(); return; } catch { await tick(1); }
  }
  check();
};
const openLesson = async () => {
  render(<LearningWorkspace />);
  await until(() => expect(screen.getAllByText('분수의 의미').length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByRole('button', { name: /분수의 의미/ })[0]);
  await until(() => expect(screen.getByRole('heading', { level: 1, name: '분수의 의미' })).toBeDefined());
};
const stepCount = () => document_text('.lesson-controls span');
const document_text = (selector: string) => window.document.querySelector(selector)!.textContent;
const statusPill = () => window.document.querySelector('.lesson-header .pill')!.textContent;

let server: ReturnType<typeof serve>;
beforeEach(() => { vi.useFakeTimers(); window.history.replaceState({}, '', '/'); server = serve(); });
afterEach(() => { vi.useRealTimers(); });

describe('a lesson opened without starting it', () => {
  it('reads the explanation but does not record anything', async () => {
    server = serve({ signedIn: false });
    await openLesson();
    expect(statusPill()).toBe('수업 미리보기');
    expect(screen.getByText('설명은 먼저 둘러볼 수 있어요.')).toBeDefined();
    expect(screen.getByText('한 덩이를 나눈 조각이에요.')).toBeDefined();
    expect(server.sent).toHaveLength(0);
  });

  it('asks a signed-out reader to start before it saves a step', async () => {
    server = serve({ signedIn: false });
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: /다음 단계/ }));
    await tick();
    // Moving on is reading, not progress: nothing is sent and the step still turns.
    expect(server.sent).toHaveLength(0);
    expect(stepCount()).toBe('2 / 2');
  });
});

describe('a step is finished when the server says so', () => {
  it('sends the step and only then moves on', async () => {
    server = serve({ state: enrolled() });
    server.state.after = (action) => action.action === 'section.complete'
      ? enrolled(['fraction-meaning:explanation:v2']) : server.state.learning;
    await openLesson();
    expect(statusPill()).toBe('학습 중');
    expect(stepCount()).toBe('1 / 2');
    fireEvent.click(screen.getByRole('button', { name: /이해했어요, 다음으로/ }));
    await tick();
    expect(server.of('section.complete')).toHaveLength(1);
    expect(stepCount()).toBe('2 / 2');
  });

  it('stays where it is when the server refuses the step', async () => {
    server = serve({ state: enrolled() });
    server.state.refuse = { action: 'section.complete', code: 'section_out_of_order', message: '앞 단계를 먼저 마쳐 주세요.' };
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: /이해했어요, 다음으로/ }));
    await tick();
    expect(stepCount()).toBe('1 / 2');
    expect(screen.getByText('앞 단계를 먼저 마쳐 주세요.')).toBeDefined();
  });

  it('completes the lesson from the last step, in two steps of its own', async () => {
    server = serve({ state: enrolled(['fraction-meaning:explanation:v2']) });
    await openLesson();
    expect(stepCount()).toBe('2 / 2');
    fireEvent.click(screen.getByRole('button', { name: /수업 완료하기/ }));
    await tick();
    expect(server.of('section.complete')).toHaveLength(1);
    expect(server.of('lesson.complete')).toHaveLength(1);
    expect(screen.getByText('오늘의 이해가 하나 더 쌓였어요.')).toBeDefined();
  });

  it('does not say the lesson is done when the server refused the last step', async () => {
    server = serve({ state: enrolled(['fraction-meaning:explanation:v2']) });
    server.state.refuse = { action: 'section.complete', code: 'failed', message: '단계를 저장하지 못했어요.' };
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: /수업 완료하기/ }));
    await tick();
    expect(server.of('lesson.complete')).toHaveLength(0);
    expect(screen.queryByText('오늘의 이해가 하나 더 쌓였어요.')).toBeNull();
  });
});

describe('a step this version cannot draw', () => {
  it('stops the step from being finished at all', async () => {
    const unknown: ContentBlock = { blockId: 'v1', kind: 'core.video', typeVersion: 1, required: true, payload: { src: 'lesson.mp4' } };
    server = serve({ state: enrolled(), lesson: document([unknown]) });
    await openLesson();
    expect(screen.getByText(/필수 콘텐츠를 표시할 수 없어 단계 완료를 멈췄어요/)).toBeDefined();
    expect(screen.getByRole('button', { name: /이해했어요, 다음으로/ }).hasAttribute('disabled')).toBe(true);
  });
});

describe('a question the step cannot take yet', () => {
  const answerBox = () => screen.getAllByLabelText('나의 답')[0] as HTMLInputElement;

  it('says which step is holding it, and goes back to that step', async () => {
    server = serve({ state: enrolled() });
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: /직접 해보기/ }));
    await tick();
    // A grey box with nothing said about it reads as a fault in the screen rather than an order.
    expect(answerBox().hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText(/앞 단계를 끝내면 이 문제를 풀 수 있어요/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /1단계로 돌아가기/ })[0]);
    await tick();
    expect(stepCount()).toBe('1 / 2');
  });

  it('tells a finished lesson apart from a step waiting its turn', async () => {
    server = serve({ state: enrolled(['fraction-meaning:explanation:v2', 'fraction-meaning:practice:v2'], 'completed') });
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: /직접 해보기/ }));
    await tick();
    expect(screen.getAllByText('학습을 마친 수업이에요. 저장한 풀이는 그대로 볼 수 있어요.').length).toBeGreaterThan(0);
    expect(screen.queryByText(/앞 단계를 끝내면/)).toBeNull();
  });
});

describe('finishing an assignment', () => {
  const saved = () => assignment({ items: [{ ...assignment().items[0], attempt: { id: 't1', problemVersionId: problemId, answer: '4', result: { status: 'correct', message: '정답이에요.', assisted: false }, hintUsed: false } }] });
  const submitButton = () => screen.getByRole('button', { name: /과제 제출하기/ });
  const openAssignment = async () => {
    render(<LearningWorkspace />);
    await until(() => expect(screen.getAllByRole('button', { name: /분수의 의미 복습/ }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: /분수의 의미 복습/ })[0]);
    await until(() => expect(screen.getByRole('button', { name: /과제 제출하기/ })).toBeDefined());
  };

  it('waits for every answer to be saved', async () => {
    server = serve({ state: learningState({ assignments: [assignment()] }) });
    await openAssignment();
    // Nothing answered yet, so there is nothing to submit.
    expect(screen.getByRole('button', { name: /과제 제출하기/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('모든 문제의 답안을 저장하면 제출할 수 있어요.')).toBeDefined();
  });

  /** Every answer is saved, so nothing else is holding submission back — what closes it here is the
   *  writing that has not been sent, and only that. */
  it('closes again when a saved answer is written over', async () => {
    server = serve({ state: learningState({ assignments: [saved()] }) });
    await openAssignment();
    expect(submitButton().hasAttribute('disabled')).toBe(false);
    fireEvent.change(screen.getByLabelText('나의 답'), { target: { value: '5' } });
    await tick();
    expect(submitButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/아직 저장하지 않은 답안이 1개 있어요/)).toBeDefined();
    // Putting it back the way it was saved is not a change, so submission opens again.
    fireEvent.change(screen.getByLabelText('나의 답'), { target: { value: '4' } });
    await tick();
    expect(submitButton().hasAttribute('disabled')).toBe(false);
  });

  /** A submission is one thing however many times it is asked for, so a retry carries the key the
   *  first attempt used rather than starting a second submission. */
  it('retries with the key the first attempt used', async () => {
    server = serve({ state: learningState({ assignments: [saved()] }) });
    server.state.refuse = { action: 'assignment.submit', code: 'failed', message: '제출하지 못했어요.' };
    await openAssignment();
    fireEvent.click(submitButton());
    await tick();
    expect(screen.getByText('제출하지 못했어요.')).toBeDefined();
    server.state.refuse = null;
    fireEvent.click(submitButton());
    await tick();
    const [first, second] = server.of('assignment.submit') as { requestId: string }[];
    expect(second.requestId).toBe(first.requestId);
    expect(screen.getByText(/과제를 제출했어요/)).toBeDefined();
  });
});

describe('a set too long to hold on one screen', () => {
  const question = (id: string, prompt: string) => ({ problemVersionId: id, conceptKeys: ['term.denominator'],
    promptContent: [text(`prompt-${id}`, prompt)], responseSpec: { kind: 'integer' as const }, hintAvailable: false, solutionAvailable: false });
  const judged = (problemVersionId: string, status: 'correct' | 'incorrect'): AttemptView => ({ id: `t-${problemVersionId}`,
    problemVersionId, answer: '4', result: { status, message: status === 'correct' ? '맞았어요.' : '아직 답이 맞지 않아요.', assisted: false }, hintUsed: false });
  const set = (attempts: (AttemptView | null)[]): AssignmentView => assignment({
    recipientId: 'r-set', title: '분수 모아 풀기', lessonKey: null, problemSetId: 'fractions:gathered',
    policy: { kind: 'practice', hints: true, results: 'per-item', solutions: 'never' },
    items: attempts.map((attempt, index) => ({ id: `i${index + 1}`, problem: question(`q${index + 1}`, `${index + 1}번 문제예요.`), attempt,
      tries: attempt ? 1 : 0, firstResult: attempt?.result ?? null })),
  });
  const openSet = async (view: AssignmentView) => {
    server = serve({ state: learningState({ assignments: [view] }) });
    render(<LearningWorkspace />);
    await until(() => expect(screen.getAllByRole('button', { name: /분수 모아 풀기/ }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: /분수 모아 풀기/ })[0]);
    await until(() => expect(screen.getByText('문제 01')).toBeDefined());
  };
  const holding = () => window.document.activeElement?.closest('section')?.id ?? null;
  const box = (index: number) => screen.getAllByLabelText('나의 답')[index];

  it('carries the count and the way back to what is left', async () => {
    await openSet(set([judged('q1', 'correct'), null, null]));
    expect(document_text('.solve-progress .solve-count')).toBe('1 / 3 저장');
    fireEvent.click(screen.getAllByRole('button', { name: /남은 문제로/ })[0]);
    await tick();
    // The strip knows which question is still waiting, so nobody has to read past the answered ones.
    expect(holding()).toBe('problem-2');
  });

  it('moves on by itself when the answer was right', async () => {
    await openSet(set([null, null, judged('q3', 'correct')]));
    server.state.after = (action) => action.action === 'attempt.submit'
      ? learningState({ assignments: [set([judged('q1', 'correct'), null, judged('q3', 'correct')])] }) : server.state.learning;
    fireEvent.change(box(0), { target: { value: '4' } });
    fireEvent.click(screen.getAllByRole('button', { name: '답안 저장' })[0]);
    await tick();
    // The third is already answered, so moving on means the second and not merely the next one.
    expect(holding()).toBe('problem-2');
  });

  it('stays where the answer was wrong', async () => {
    await openSet(set([null, null, null]));
    server.state.after = (action) => action.action === 'attempt.submit'
      ? learningState({ assignments: [set([judged('q1', 'incorrect'), null, null])] }) : server.state.learning;
    fireEvent.change(box(0), { target: { value: '4' } });
    fireEvent.click(screen.getAllByRole('button', { name: '답안 저장' })[0]);
    await tick();
    expect(holding()).not.toBe('problem-2');
    expect(screen.getByText('아직 답이 맞지 않아요.')).toBeDefined();
  });

  it('reads the finished set back by concept, from the answers that were already sent', async () => {
    const wrong = judged('q1', 'incorrect');
    const view = set([wrong, judged('q2', 'correct'), judged('q3', 'correct')]);
    // Every question here is about the same concept, and the first answer to the first one was
    // wrong in a way the marker could name.
    view.status = 'submitted';
    view.items[0].firstResult = { ...wrong.result, misreading: 'sign' };
    // A set that is done waits in 「다 푼 문제집」 rather than among the work still to do.
    server = serve({ state: learningState({ assignments: [view] }) });
    render(<LearningWorkspace />);
    await until(() => expect(screen.getAllByRole('button', { name: '연습장' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: '연습장' })[0]);
    await until(() => expect(screen.getByText('다 푼 문제집')).toBeDefined());
    fireEvent.click(screen.getAllByRole('button', { name: /분수 모아 풀기/ })[0]);
    await until(() => expect(window.document.querySelector('.answer-report')).not.toBeNull());
    expect(window.document.querySelector('.report-score')!.textContent).toBe('2 / 3');
    expect(window.document.querySelector('.report-count')!.textContent).toBe('2 / 3');
    expect(screen.getByText('부호를 놓친 답')).toBeDefined();
  });

  /** A pair of questions shares a screen, so the strip would only repeat what is already in view. */
  it('leaves a short set alone', async () => {
    await openSet(set([null, null]));
    expect(window.document.querySelector('.solve-progress')).toBeNull();
    expect(screen.getByText('문제 02')).toBeDefined();
  });
});

describe('reading the worked solution', () => {
  /** A lesson whose one question carries a solution, opened on the step that asks it. */
  const withSolution = (attempt: AttemptView | null) => {
    const solved = document();
    solved.problems = [{ ...solved.problems[0], solutionAvailable: true }];
    server = serve({ lesson: solved, state: { ...enrolled(['fraction-meaning:explanation:v2']),
      enrollments: [{ id: 'e1', lessonKey, lessonVersionId: 'fraction-meaning:v2',
        completedSectionIds: ['fraction-meaning:explanation:v2'], status: 'active', attempts: attempt ? [attempt] : [] }] } });
  };
  const answered: AttemptView = { id: 't1', problemVersionId: problemId, answer: '3',
    result: { status: 'incorrect', message: '아직 답이 맞지 않아요.', assisted: false }, hintUsed: false };

  it('offers nothing until the learner has answered', async () => {
    withSolution(null);
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: /직접 해보기/ }));
    await until(() => expect(screen.getByText('분모는 얼마인가요?')).toBeDefined());
    // A solution handed out before an answer is not a solution, it is the answer.
    expect(screen.queryByRole('button', { name: '풀이 보기' })).toBeNull();
  });

  it('opens it once an answer is in, even a wrong one, and folds it away again', async () => {
    withSolution(answered);
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: /직접 해보기/ }));
    await until(() => expect(screen.getByRole('button', { name: '풀이 보기' })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '풀이 보기' }));
    await until(() => expect(screen.getByText('넷으로 나눈 한 조각이니 분모는 4예요.')).toBeDefined());
    expect(server.of('solution.open')[0]).toEqual({ action: 'solution.open', context: 'lesson',
      contextId: 'e1', problemVersionId: problemId });
    fireEvent.click(screen.getByRole('button', { name: '풀이 접기' }));
    await tick();
    expect(screen.queryByText('넷으로 나눈 한 조각이니 분모는 4예요.')).toBeNull();
    // Folding it away does not ask the server for it a second time.
    expect(server.of('solution.open')).toHaveLength(1);
  });

  it('waits for a set to be handed in, however many questions are answered', async () => {
    const solved = (status: 'assigned' | 'submitted'): AssignmentView => assignment({ recipientId: 'r-own', title: '분수의 의미 연습',
      problemSetId: 'fraction-meaning:practice', lessonKey: null, status,
      policy: { kind: 'practice', hints: true, results: 'per-item', solutions: 'after-submission' },
      items: [{ id: 'i1', problem: { problemVersionId: problemId, conceptKeys: ['term.denominator'], promptContent: [text('p1', '분모는 얼마인가요?')],
        responseSpec: { kind: 'integer' }, hintAvailable: false, solutionAvailable: true }, attempt: answered, tries: 1, firstResult: answered.result }] });
    const open = async (view: AssignmentView) => {
      server = serve({ state: learningState({ assignments: [view] }) });
      render(<LearningWorkspace />);
      await until(() => expect(screen.getAllByRole('button', { name: '연습장' }).length).toBeGreaterThan(0));
      fireEvent.click(screen.getAllByRole('button', { name: '연습장' })[0]);
      await until(() => expect(screen.getByRole('button', { name: /분수의 의미 연습/ })).toBeDefined());
      fireEvent.click(screen.getByRole('button', { name: /분수의 의미 연습/ }));
      await until(() => expect(screen.getByRole('heading', { level: 1, name: '분수의 의미 연습' })).toBeDefined());
    };
    await open(solved('assigned'));
    // Everything in a set stays answerable until it is handed in, so no solution is offered yet.
    expect(screen.queryByRole('button', { name: '풀이 보기' })).toBeNull();
    cleanup();
    await open(solved('submitted'));
    expect(screen.getByRole('button', { name: '풀이 보기' })).toBeDefined();
  });
});

describe('the lessons the home screen puts nearest', () => {
  const shelf = () => [...window.document.querySelectorAll('.page-home .class-grid .class-card h3')].map((node) => node.textContent);
  const heading = () => [...window.document.querySelectorAll('.page-home .dashboard-section h2')][0]?.textContent;

  it('does not offer the lesson the hero is already offering', async () => {
    server = serve({ state: learningState({ lessons: twoCourses, recommendations: [{ lessonKey, reason: '여기부터요.', kind: 'start', suggestedMinutes: 10 }] }) });
    render(<LearningWorkspace />);
    await until(() => expect(heading()).toBeDefined());
    // The hero names 분수의 의미, so the shelf below it moves on to what comes next.
    expect(shelf()).not.toContain('분수의 의미');
    expect(shelf()).toContain('소수의 의미');
  });

  it('leads with what someone is in the middle of, and says so', async () => {
    server = serve({ state: learningState({
      lessons: twoCourses,
      enrollments: [{ id: 'e2', lessonKey: laterKey, lessonVersionId: 'decimal-meaning:v1', completedSectionIds: [], status: 'active', attempts: [] }],
      recommendations: [{ lessonKey, reason: '여기부터요.', kind: 'start', suggestedMinutes: 10 }],
    }) });
    render(<LearningWorkspace />);
    await until(() => expect(heading()).toBe('이어서 배울 수업'));
    expect(shelf()[0]).toBe('소수의 의미');
  });

  it('calls the shelf a beginning only when there is no record at all', async () => {
    server = serve({ signedIn: false });
    render(<LearningWorkspace />);
    await until(() => expect(heading()).toBe('차근차근, 기본부터'));
  });
});

describe('the assignments the home screen puts nearest', () => {
  const rows = () => [...window.document.querySelectorAll('.page-home .assignment-row .assignment-info strong')].map((node) => node.textContent);
  const withDates = (recipientId: string, title: string, dates: Partial<AssignmentView>): AssignmentView =>
    ({ ...assignment(), id: recipientId, recipientId, title, submissionId: `s-${recipientId}`, ...dates });

  it('puts a deadline above a review that has waited longer', async () => {
    const soon = new Date(Date.now() + 2 * 86400000).toISOString();
    const longAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    server = serve({ state: learningState({ assignments: [
      withDates('r1', '오래 기다린 복습', { recommendedAt: longAgo }),
      withDates('r2', '마감이 있는 숙제', { dueAt: soon }),
    ] }) });
    render(<LearningWorkspace />);
    await until(() => expect(rows().length).toBe(2));
    expect(rows()).toEqual(['마감이 있는 숙제', '오래 기다린 복습']);
  });

  it('does not repeat the one the review callout is already offering', async () => {
    const state = learningState({ assignments: [
      withDates('r1', '복습 안내가 고른 과제', {}), withDates('r2', '그 다음 과제', {}),
    ] });
    state.plan = { ...state.plan, review: { recipientId: 'r1', reason: '권장 복습 시점이 되었어요.' } };
    server = serve({ state });
    render(<LearningWorkspace />);
    await until(() => expect(rows().length).toBeGreaterThan(0));
    // The callout above the shelf already names it, so the shelf moves on.
    expect(rows()).toEqual(['그 다음 과제']);
    expect(screen.getByText(/권장 복습 시점이 되었어요/)).toBeDefined();
  });
});

describe('leaving for good', () => {
  const openProfile = async () => {
    render(<LearningWorkspace />);
    await until(() => expect(screen.getByRole('button', { name: /학습자/ })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /학습자/ }));
    await until(() => expect(screen.getByRole('button', { name: /계정과 학습 기록 지우기/ })).toBeDefined());
  };

  it('says what goes before anything goes', async () => {
    await openProfile();
    fireEvent.click(screen.getByRole('button', { name: /계정과 학습 기록 지우기/ }));
    expect(screen.getByText(/되돌릴 수 없고 복구해 드릴 방법도 없어요/)).toBeDefined();
    expect(screen.getByText(/새 학습 공간으로 시작해요/)).toBeDefined();
    // Asking is not doing: nothing has been sent yet.
    expect(server.deletes()).toHaveLength(0);
  });

  it('lets the reader step back out of it', async () => {
    await openProfile();
    fireEvent.click(screen.getByRole('button', { name: /계정과 학습 기록 지우기/ }));
    fireEvent.click(screen.getByRole('button', { name: '그만두기' }));
    expect(screen.queryByText(/되돌릴 수 없고/)).toBeNull();
    expect(server.deletes()).toHaveLength(0);
  });

  it('asks once, then lets go of everything it was holding', async () => {
    await openProfile();
    fireEvent.click(screen.getByRole('button', { name: /계정과 학습 기록 지우기/ }));
    fireEvent.click(screen.getByRole('button', { name: /네, 지울게요/ }));
    await until(() => expect(screen.getByText(/계정과 학습 기록을 지웠어요/)).toBeDefined());
    expect(server.deletes()).toHaveLength(1);
    // What is left is what anyone may see.
    await until(() => expect(screen.getByRole('button', { name: /내 학습 시작/ })).toBeDefined());
    expect(screen.queryByText('학습자')).toBeNull();
  });

  it('keeps the records when the server refuses', async () => {
    server.state.refuseDelete = { code: 'content_role_held', message: '콘텐츠 편집 권한이 있는 계정이에요.' };
    await openProfile();
    fireEvent.click(screen.getByRole('button', { name: /계정과 학습 기록 지우기/ }));
    fireEvent.click(screen.getByRole('button', { name: /네, 지울게요/ }));
    // The refusal is said both in the dialog and behind it, so this counts rather than picks.
    await until(() => expect(screen.getAllByText(/콘텐츠 편집 권한이 있는 계정이에요/).length).toBeGreaterThan(0));
    // Still signed in, and the question is still open to answer or back out of.
    expect(screen.getByRole('button', { name: /학습자/ })).toBeDefined();
    expect(screen.getByRole('button', { name: '그만두기' })).toBeDefined();
  });
});

describe('the account behind the records', () => {
  it('drops what it was holding when the server says the account changed', async () => {
    server = serve({ state: enrolled() });
    // The account really is gone: what the screen was holding belongs to nobody now.
    server.state.refuse = { action: 'section.complete', code: 'account_changed', message: '다른 계정으로 바뀌었어요. 다시 불러올게요.',
      then: () => { server.state.signedIn = false; } };
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: /이해했어요, 다음으로/ }));
    await until(() => expect(screen.getByText(/다른 계정으로 바뀌었어요/)).toBeDefined());
    // It is let go of and reloaded, and what is left is what anyone may see.
    await until(() => expect(screen.getByRole('button', { name: /내 학습 시작/ })).toBeDefined());
    expect(screen.queryByText('학습자')).toBeNull();
  });
});

describe('a course beside the line the catalogue is ordered along', () => {
  const ncsLesson: PublicLesson = { lessonKey: 'ncs-price', versionId: 'ncs-price:v1', title: '원가와 정가',
    summary: '붙인 만큼과 깎은 만큼', estimatedMinutes: 10, conceptKeys: ['cost-price'],
    prerequisiteConceptKeys: ['term.denominator'], sectionCount: 5, courseKey: 'ncs-applied' };
  const twoTracks = () => serve({
    courses: [{ key: 'fractions', title: '분수', summary: '분수를 처음부터', track: 'basics' },
      { key: 'ncs-applied', title: '응용계산', summary: '시험이 묻는 방식 그대로', track: 'ncs' }],
    catalogue: [...catalogue, ncsLesson],
    // A signed-in learner reads the lessons from their own state, which is the same catalogue.
    state: learningState({ lessons: [...catalogue, ncsLesson] }),
  });
  const openCatalogue = async () => {
    render(<LearningWorkspace />);
    await until(() => expect(screen.getAllByRole('button', { name: '수업' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: '수업' })[0]);
    await until(() => expect(screen.getAllByText('응용계산').length).toBeGreaterThan(1));
  };
  const headings = () => [...window.document.querySelectorAll('.track-heading h2, .catalog-banner h3')].map((node) => node.textContent);

  it('is listed under its own line rather than after the last school course', async () => {
    server = twoTracks();
    await openCatalogue();
    // The school line first and whole, then the other line, each said out loud before its courses.
    expect(headings()).toEqual(['기초 과정', '분수', 'NCS 수리영역', '응용계산']);
  });

  it('groups the chips into the same lines, and keeps both reachable after one is picked', async () => {
    server = twoTracks();
    await openCatalogue();
    const rows = () => [...window.document.querySelectorAll('.course-filter-line')].map((row) => [...row.children].map((node) => node.textContent));
    expect(rows()).toEqual([['모든 코스'], ['분수'], ['응용계산']]);
    fireEvent.click(screen.getByRole('button', { name: '응용계산' }));
    // Picking narrows the courses listed below, never the chips: the school line stays one click away.
    expect(rows()).toEqual([['모든 코스'], ['분수'], ['응용계산']]);
    expect(headings()).toEqual(['NCS 수리영역', '응용계산']);
  });

  it('cuts a line into the school years it holds, in the catalogue and in the chips', async () => {
    // 「중2까지 했어요」 names a place in the catalogue; 「수학 과정」 does not. The chips and the
    // list are cut the same way, so the chip a learner presses and the heading they scroll to match.
    const spread: PublicLesson[] = [...catalogue,
      { ...catalogue[0], lessonKey: 'negative-number', versionId: 'negative-number:v1', title: '음수와 수직선', courseKey: 'integers' },
      { ...catalogue[0], lessonKey: 'linear-function', versionId: 'linear-function:v1', title: '일차함수와 그래프', courseKey: 'functions' }];
    server = serve({
      courses: [{ key: 'fractions', title: '분수', summary: '분수를 처음부터', track: 'basics' },
        { key: 'integers', title: '정수와 유리수', summary: '음수부터', track: 'middle', stage: 'middle-1' },
        { key: 'functions', title: '일차함수', summary: '직선으로', track: 'middle', stage: 'middle-2' }],
      catalogue: spread, state: learningState({ lessons: spread }),
    });
    render(<LearningWorkspace />);
    await until(() => expect(screen.getAllByRole('button', { name: '수업' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: '수업' })[0]);
    await until(() => expect(screen.getAllByText('정수와 유리수').length).toBeGreaterThan(0));
    // 기초 과정 keeps no years, so its courses sit under the line itself; 중학교 과정 is cut in two.
    expect([...window.document.querySelectorAll('.track-heading h2, .stage-heading, .catalog-banner h3')].map((node) => node.textContent))
      .toEqual(['기초 과정', '분수', '중학교 과정', '중1', '정수와 유리수', '중2', '일차함수']);
    expect([...window.document.querySelectorAll('.course-filter-line')].map((row) => [...row.children].map((node) => node.textContent)))
      .toEqual([['모든 코스'], ['분수'], ['중1', '정수와 유리수'], ['중2', '일차함수']]);
  });

  it('says nothing about lines when every course is on the same one', async () => {
    server = serve();
    render(<LearningWorkspace />);
    await until(() => expect(screen.getAllByRole('button', { name: '수업' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: '수업' })[0]);
    await until(() => expect(screen.getByText('분수의 의미')).toBeDefined());
    expect(window.document.querySelector('.track-heading')).toBeNull();
  });
});

describe('picking a problem set to solve', () => {
  it('opens the course, starts the set, and lands on its questions', async () => {
    const server = serve();
    render(<LearningWorkspace />);
    await until(() => expect(screen.getAllByRole('button', { name: '연습장' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: '연습장' })[0]);
    await until(() => expect(screen.getByText('문제집 골라 풀기')).toBeDefined());
    // A course is closed until it is opened, so no set is offered before somebody asks for one.
    expect(screen.queryByText('분수의 의미 연습')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /문제집 2개/ }));
    await until(() => expect(screen.getByText('분수의 의미 연습')).toBeDefined());
    // The sets arrive in lesson order, and the lesson they belong to names the group.
    expect(screen.getAllByText(/분수의 의미 (연습|확인)/).map((node) => node.textContent))
      .toEqual(['분수의 의미 연습', '분수의 의미 확인']);
    fireEvent.click(screen.getByRole('button', { name: /분수의 의미 연습/ }));
    await until(() => expect(server.of('problemSet.start')).toHaveLength(1));
    expect(server.of('problemSet.start')[0]).toEqual({ action: 'problemSet.start', problemSetId: 'fraction-meaning:practice' });
  });

  it('is reachable from the course itself, opened where the learner asked', async () => {
    serve();
    render(<LearningWorkspace />);
    await until(() => expect(screen.getAllByRole('button', { name: '수업' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: '수업' })[0]);
    // A course says what it keeps besides its lessons, which is the only reason anybody knows to look,
    // and it says it on a card among the lesson cards rather than in a line of text under them.
    await until(() => expect(screen.getByRole('button', { name: /문제집 2개 풀기/ })).toBeDefined());
    expect(screen.getByRole('button', { name: /문제집 2개 풀기/ }).classList.contains('class-card')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /문제집 2개 풀기/ }));
    // Arriving this way, the sets are already there — no second click to undo the hiding.
    await until(() => expect(screen.getByText('분수의 의미 연습')).toBeDefined());
    expect(screen.getByText('문제집 골라 풀기')).toBeDefined();
  });

  it('is reachable from the lesson that shows it, landing on that lesson\u2019s sets', async () => {
    await openLesson();
    fireEvent.click(screen.getByRole('button', { name: /이 수업의 문제집 2개/ }));
    await until(() => expect(screen.getByText('분수의 의미 연습')).toBeDefined());
    // The lesson's own group carries an id, so the way in can point at it rather than at the course.
    expect(window.document.getElementById('shelf-fractions-fraction-meaning')).not.toBeNull();
  });

  it('leaves a course open when another one is opened, since a shelf hides nothing', async () => {
    serve({ catalogue: twoCourses });
    render(<LearningWorkspace />);
    await until(() => expect(screen.getAllByRole('button', { name: '연습장' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: '연습장' })[0]);
    await until(() => expect(screen.getByRole('button', { name: /문제집 2개/ })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /문제집 2개/ }));
    await until(() => expect(screen.getByText('분수의 의미 연습')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /문제집 1개/ }));
    await until(() => expect(screen.getByText('소수의 의미 연습')).toBeDefined());
    // Opening the second did not close the first, which is what an accordion would have done.
    expect(screen.getByText('분수의 의미 연습')).toBeDefined();
    // And the head is still a toggle: pressing it again puts that one course away.
    fireEvent.click(screen.getByRole('button', { name: /문제집 2개/ }));
    await until(() => expect(screen.queryByText('분수의 의미 연습')).toBeNull());
    expect(screen.getByText('소수의 의미 연습')).toBeDefined();
  });

  it('wears its lesson\u2019s drawing, so the sets under one lesson are read as siblings', async () => {
    serve({ catalogue: twoCourses });
    render(<LearningWorkspace />);
    await until(() => expect(screen.getAllByRole('button', { name: '연습장' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: '연습장' })[0]);
    await until(() => expect(screen.getByRole('button', { name: /문제집 2개/ })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /문제집 2개/ }));
    fireEvent.click(screen.getByRole('button', { name: /문제집 1개/ }));
    await until(() => expect(screen.getByText('소수의 의미 연습')).toBeDefined());
    const tone = (node: Element) => [...node.classList].find((name) => name.startsWith('art-'));
    const marks = [...window.document.querySelectorAll('.shelf-set > .class-art.small')].map(tone);
    // Every set carries one, and the two 분수의 의미 sets carry the same one because one lesson shows both.
    expect(marks).toHaveLength(3);
    expect(marks[0]).toBe(marks[1]);
    // And it is the lesson's own drawing, not one the set made up: the card on 수업 wears it too.
    fireEvent.click(screen.getAllByRole('button', { name: '수업' })[0]);
    await until(() => expect(screen.getByText('분수의 의미')).toBeDefined());
    const card = screen.getByText('분수의 의미').closest('.class-card')!;
    expect(tone(card.querySelector('.class-art')!)).toBe(marks[0]);
  });

  it('calls work the learner chose their own, not an assignment', async () => {
    const own: AssignmentView = assignment({ recipientId: 'r-own', title: '분수의 의미 연습',
      problemSetId: 'fraction-meaning:practice', lessonKey: null,
      policy: { kind: 'practice', hints: true, results: 'per-item', solutions: 'never' } });
    serve({ state: { ...learningState(), assignments: [own], plan: { ...learningState().plan, review: null } } });
    render(<LearningWorkspace />);
    await until(() => expect(screen.getAllByRole('button', { name: '연습장' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: '연습장' })[0]);
    await until(() => expect(screen.getByText('풀던 문제집')).toBeDefined());
    // Nobody assigned it, so the assigned list stays empty and says so.
    expect(screen.getByText('남아 있는 과제가 없어요')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /분수의 의미 연습/ }));
    await until(() => expect(screen.getByRole('heading', { level: 1, name: '분수의 의미 연습' })).toBeDefined());
    expect(screen.getByText(/다 풀었어요/)).toBeDefined();
    expect(screen.queryByText('과제 제출하기')).toBeNull();
  });
});
