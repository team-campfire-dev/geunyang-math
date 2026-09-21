// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from './render';
import { ConceptPicker, ProblemPanel, ProblemSetEditor } from '@/features/authoring/problem-editor';
import { ExpertMode } from '@/features/authoring/expert-mode';
import { WrongAnswers } from '@/features/authoring/wrong-answers';
import type { AnswerSpec } from '@/shared/answer';
import type { ContentBlock } from '@/shared/api';
import type { ConceptChoice, DraftProblem } from '@/shared/authoring';

const concepts: ConceptChoice[] = [
  { key: 'term.denominator', label: '분모', assessable: true },
  { key: 'term.numerator', label: '분자', assessable: true },
];
const problem = (problemVersionId: string, gradingSpec: AnswerSpec): DraftProblem =>
  ({ problemVersionId, conceptKeys: ['term.denominator'], promptContent: [], gradingSpec, hints: [], solution: [] });
const panel = (open: DraftProblem, extra: Partial<Parameters<typeof ProblemPanel>[0]> = {}) => <ProblemPanel
  problem={open} number={1} total={2} concepts={concepts} taken={[]} definitionChoices={[]}
  onAnswerInput={() => {}} onChange={() => {}} onMove={() => {}} onCopy={() => {}} onRemove={() => {}} {...extra} />;
const answerBox = () => screen.getByPlaceholderText('예: -3, 2.5, 1/4') as HTMLInputElement;

describe('the answer a question accepts', () => {
  /** The panel showed the answer of whichever question was opened first; a second question kept the
   *  first one's number while the saved rule said something else. */
  it('follows the question that is open', () => {
    const { rerender } = render(panel(problem('p1', { kind: 'integer', value: 3 })));
    expect(answerBox().value).toBe('3');
    rerender(panel(problem('p2', { kind: 'integer', value: 7 })));
    expect(answerBox().value).toBe('7');
    rerender(panel(problem('p3', { kind: 'rational', numerator: 1, denominator: 4 })));
    expect(answerBox().value).toBe('1/4');
  });

  it('keeps what the author wrote while it still describes this answer', () => {
    const spec: AnswerSpec = { kind: 'rational', numerator: 1, denominator: 2 };
    render(panel(problem('p1', spec), { answerInput: { text: '0.5', spec: JSON.stringify(spec) } }));
    expect(answerBox().value).toBe('0.5');
  });

  it('reports a written answer and the rule it makes', () => {
    const onAnswerInput = vi.fn();
    const onChange = vi.fn();
    render(panel(problem('p1', { kind: 'integer', value: 3 }), { onAnswerInput, onChange }));
    fireEvent.change(answerBox(), { target: { value: '5' } });
    expect(onAnswerInput).toHaveBeenCalledWith({ text: '5', spec: JSON.stringify({ kind: 'integer', value: 5 }) });
    expect(onChange.mock.calls[0][0].gradingSpec).toEqual({ kind: 'integer', value: 5 });
  });

  it('holds an answer it cannot read on the screen instead of the last good one', () => {
    const spec: AnswerSpec = { kind: 'integer', value: 3 };
    const onAnswerInput = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(panel(problem('p1', spec), { onAnswerInput, onChange }));
    fireEvent.change(answerBox(), { target: { value: 'abc' } });
    // Nothing readable was written, so the saved rule is untouched and only the screen changes.
    expect(onChange).not.toHaveBeenCalled();
    rerender(panel(problem('p1', spec), { onAnswerInput, onChange, answerInput: onAnswerInput.mock.calls[0][0] }));
    expect(answerBox().value).toBe('abc');
    expect(answerBox().getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('저장하거나 발행할 수 없어요');
  });

  it('says what a question accepts without the fold being opened', () => {
    // The same sentence names the range below the box and the switch that changes it, so this
    // reads the summary line rather than whichever of the two comes first.
    const { container, rerender } = render(panel(problem('p1', { kind: 'integer', value: 3 })));
    const summary = () => container.querySelector('.editor-answer > label small')!.textContent;
    expect(summary()).toBe('정수만 인정');
    rerender(panel(problem('p2', { kind: 'rational', numerator: 1, denominator: 4 })));
    expect(summary()).toBe('값이 같으면 정수·소수·분수 모두 인정');
    rerender(panel(problem('p3', { kind: 'rational', numerator: 1, denominator: 4, requiredForm: 'reduced_fraction' })));
    expect(summary()).toBe('기약분수로 쓴 답만 인정');
  });
});

describe('the names the records use', () => {
  it('stays out of the way until the reader also operates the service', () => {
    const { rerender } = render(panel(problem('fraction-meaning:practice:p1:v2', { kind: 'integer', value: 3 })));
    expect(screen.queryByText('fraction-meaning:practice:p1:v2')).toBeNull();
    rerender(<ExpertMode.Provider value={true}>{panel(problem('fraction-meaning:practice:p1:v2', { kind: 'integer', value: 3 }))}</ExpertMode.Provider>);
    expect(screen.getByText('fraction-meaning:practice:p1:v2')).toBeDefined();
  });
});

describe('choosing the concepts a question asks about', () => {
  it('shows what is chosen and searches for the rest', () => {
    const onChange = vi.fn();
    render(<ConceptPicker concepts={concepts} chosen={[]} onChange={onChange} />);
    expect(screen.getByText('아직 고른 개념이 없어요.')).toBeDefined();
    expect(screen.queryByRole('button', { name: /분자/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('이 문제가 확인하는 개념 검색'), { target: { value: '분자' } });
    fireEvent.click(screen.getByRole('button', { name: '분자' }));
    expect(onChange).toHaveBeenCalledWith(['term.numerator']);
  });

  it('says so when a search finds nothing', () => {
    render(<ConceptPicker concepts={concepts} chosen={[]} onChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('이 문제가 확인하는 개념 검색'), { target: { value: '통분' } });
    expect(screen.getByText('찾은 개념이 없어요.')).toBeDefined();
  });

  it('takes a chosen concept back out', () => {
    const onChange = vi.fn();
    render(<ConceptPicker concepts={concepts} chosen={['term.denominator', 'term.numerator']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '분모 빼기' }));
    expect(onChange).toHaveBeenCalledWith(['term.numerator']);
  });
});

describe('the questions one activity holds', () => {
  const activity = (problemVersionIds: string[]): ContentBlock =>
    ({ blockId: 'practice:set', kind: 'core.problem_set', typeVersion: 2, required: true, payload: { problemVersionIds } });
  const editor = (block: ContentBlock, problems: DraftProblem[], extra: Partial<Parameters<typeof ProblemSetEditor>[0]> = {}) => <ProblemSetEditor
    block={block} problems={problems} lessonKey="fraction-meaning" role="practice" versionId="v2"
    concepts={concepts} onPick={() => {}} onChange={() => {}} {...extra} />;

  it('warns when the activity names a question this version does not hold', () => {
    render(editor(activity(['p1', 'p2']), [problem('p1', { kind: 'integer', value: 3 })]));
    expect(screen.getByText(/1개가 이 판본에 없어요/)).toBeDefined();
  });

  it('adds a question to the activity and to the version in one change', () => {
    const onChange = vi.fn();
    const onPick = vi.fn();
    render(editor(activity(['p1']), [problem('p1', { kind: 'integer', value: 3 })], { onChange, onPick }));
    fireEvent.click(screen.getByRole('button', { name: /문항 추가/ }));
    const [block, problems] = onChange.mock.calls[0];
    expect(problems).toHaveLength(2);
    expect(block.payload.problemVersionIds).toEqual(['p1', problems[1].problemVersionId]);
    expect(onPick).toHaveBeenCalledWith(problems[1].problemVersionId);
  });

  it('puts a copy straight after the question it came from', () => {
    const onChange = vi.fn();
    render(editor(activity(['p1', 'p2']), [problem('p1', { kind: 'integer', value: 3 }), problem('p2', { kind: 'integer', value: 7 })], { onChange }));
    fireEvent.click(screen.getByRole('button', { name: '1번 문항 복제' }));
    const [block, problems] = onChange.mock.calls[0];
    expect(block.payload.problemVersionIds[1]).toBe(problems[2].problemVersionId);
    expect(problems[2].gradingSpec).toEqual({ kind: 'integer', value: 3 });
  });
});

describe('naming what a wrong answer means', () => {
  const open = () => {
    const spec: AnswerSpec = { kind: 'rational', numerator: 5, denominator: 6 };
    const changes: DraftProblem[] = [];
    const ask = vi.fn(async () => [
      { answer: '2/5', count: 7, learners: 4 },
      { answer: '0.9', count: 1, learners: 1 },
    ]);
    render(<WrongAnswers.Provider value={ask}>
      {panel(problem('sum:v1', spec), { onChange: (next: DraftProblem) => changes.push(next) })}
    </WrongAnswers.Provider>);
    fireEvent.click(screen.getByText(/오답의 뜻/));
    return { changes, ask };
  };

  it('offers what learners really wrote, commonest first, with how many people wrote it', async () => {
    const { ask } = open();
    // Nothing is asked for until somebody asks: a panel that opened would fetch on every question.
    expect(ask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '학습자가 쓴 오답 보기' }));
    await screen.findByText('2/5');
    expect(ask).toHaveBeenCalledWith('sum:v1');
    expect(screen.getByText('7번 · 4명')).toBeDefined();
    expect(screen.getByText('1번 · 1명')).toBeDefined();
  });

  it('writes the name onto the question, by value rather than by spelling', async () => {
    const { changes } = open();
    fireEvent.click(screen.getByRole('button', { name: '학습자가 쓴 오답 보기' }));
    await screen.findByText('2/5');
    fireEvent.change(screen.getByLabelText('2/5에 뜻 달기'), { target: { value: 'add-denominators' } });
    expect(changes.at(-1)!.misreadings).toEqual([{ answer: '2/5', misconception: 'add-denominators' }]);
  });

  it('shows a picked question its own options, by what they say rather than by their letter', () => {
    const spec: AnswerSpec = { kind: 'choice', correct: 'b',
      options: [{ id: 'a', text: '분모끼리 더해요' }, { id: 'b', text: '통분해요' }, { id: 'c', text: '그대로 둬요' }] };
    render(panel(problem('pick:v1', spec)));
    fireEvent.click(screen.getByText(/오답의 뜻/));
    // The right one is not offered: naming it would tell a learner who got it right they were wrong.
    expect(screen.getByText('분모끼리 더해요')).toBeDefined();
    expect(screen.getByText('그대로 둬요')).toBeDefined();
    expect(screen.queryByText('통분해요')).toBeNull();
  });

  it('says what publishing would refuse, where the author can still fix it', () => {
    const spec: AnswerSpec = { kind: 'rational', numerator: 5, denominator: 6 };
    const named = { ...problem('sum:v1', spec), misreadings: [{ answer: '10/12', misconception: 'add-denominators' }] };
    render(panel(named));
    fireEvent.click(screen.getByText('오답의 뜻 · ', { exact: false, selector: 'summary' }));
    expect(screen.getByRole('alert').textContent).toMatch(/맞는 답으로 채점될 값/);
  });
});
