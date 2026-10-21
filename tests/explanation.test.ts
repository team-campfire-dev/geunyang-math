import { describe, expect, it } from 'vitest';
import { checkSolution, solutionRequest, type ProblemForExplanation } from '@/server/explanation';

const problem = (over: Partial<ProblemForExplanation> = {}): ProblemForExplanation => ({
  problemVersionId: 'pythagoras:practice-1:v1', prompt: '직각을 낀 두 변이 $3$과 $4$인 직각삼각형의 빗변의 길이를 써 주세요.',
  options: [], spec: { kind: 'integer', value: 5 }, hints: ['$3^2 + 4^2$을 먼저 구해요.'],
  misreadings: [{ answer: '7', misconception: null }],
  course: { title: '피타고라스 정리', stage: 'middle-2' },
  lesson: { title: '피타고라스 정리: 두 변을 알면 나머지 하나', concepts: ['피타고라스 정리'], summary: '직각삼각형에서 $a^2 + b^2 = c^2$이에요.' },
  ...over,
});

describe('what a 해설 writer is told', () => {
  it('says the grade, the answer, the expected wrong answers and the lesson, the same way every time', () => {
    const request = solutionRequest(problem());
    expect(request).toContain('코스: 피타고라스 정리 (중2)');
    expect(request).toContain('제곱근 기호(√)와 무리수는 중3에서 배운다');
    expect(request).toContain('정답: 5');
    expect(request).toContain('- 7');
    expect(request).toContain('수업의 정리: 직각삼각형에서');
    expect(solutionRequest(problem())).toBe(request);
  });

  it('names a picked answer by its words, since the screen shuffles the options', () => {
    const request = solutionRequest(problem({ options: ['직각삼각형', '예각삼각형'],
      spec: { kind: 'choice', options: [{ id: 'a', text: '직각삼각형' }, { id: 'b', text: '예각삼각형' }], correct: 'a' } }));
    expect(request).toContain('정답: 「직각삼각형」인 보기');
    expect(request).not.toMatch(/정답: a\b/);
  });
});

describe('what is checked before anybody reads a 해설', () => {
  it('passes one that reaches the answer in the house style', () => {
    expect(checkSolution('두 변을 제곱해 더하면 $3^2 + 4^2 = 25$예요. 제곱해서 $25$가 되는 양수는 $5$이니 빗변은 $5$예요.', problem())).toEqual([]);
  });

  it('names what a reader should not have to find', () => {
    const codes = (text: string, over?: Partial<ProblemForExplanation>) => checkSolution(text, problem(over)).map((issue) => issue.code);
    expect(codes('제곱해서 더하면 $25$예요.')).toContain('answer-missing');
    expect(codes('빗변은 $\\sqrt{25} = 5$예요.')).toContain('beyond-stage');
    expect(codes('빗변은 $5 cm$입니다.')).toContain('formal');
    expect(codes('빗변은 $5$cm이고 $3^2 + 4^2 = 25$개예요 $x')).toContain('math-unclosed');
    expect(codes('빗변은 $5\\frac{$예요.')).toContain('math-error');
    expect(codes('빗변은 $5 \\text{센티}$예요.')).toContain('hangul-in-math');
    expect(codes('①번이 맞아요. 빗변은 $5$예요.')).toContain('option-label');
    expect(codes('답은 $\\frac{3}{4}$예요.', { spec: { kind: 'rational', numerator: 3, denominator: 4 } })).toEqual([]);
  });
});
