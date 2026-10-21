import 'server-only';
import katex from 'katex';
import { z } from 'zod';
import { answerText, type AnswerSpec } from '@/shared/answer';
import { misconceptionOf } from '@/shared/misconception';
import { courseStageLabels, type CourseStage } from '@/shared/api';
import { writingGuide } from './writing-guide';

/**
 * Writing the 해설 of a question that is already published: what a model is told, what it hands
 * back, and the checks a written one has to pass before anybody reads it.
 *
 * The question is fixed — its prompt, answer and hints are frozen with its version — and a 해설 is
 * not, so this only ever adds the explanation. Whoever writes it is told exactly the same thing,
 * which is what lets two models be compared on it.
 */

export const solutionSchema = z.object({
  solution: z.string().describe('학습자가 답을 낸 뒤에 읽는 해설. 빈 줄로 문단을 나눈다.'),
});
export type WrittenSolution = z.infer<typeof solutionSchema>;

/** Something that writes a 해설. Claude and Gemini are two; the comparison does not care which is which. */
export type Explainer = {
  /** What the comparison files call it. Never shown to whoever is choosing. */
  name: string;
  explain(system: string, user: string): Promise<{ solution: string; served: string; usage: { input: number; output: number; thinking?: number } }>;
};

/** What a stage has not learned yet, said to the writer so the explanation stays inside it. */
const notYet: Partial<Record<CourseStage, string>> = {
  'middle-2': '제곱근 기호(√)와 무리수는 중3에서 배운다. 쓰지 않는다. 제곱한 값에서 길이를 구할 때는 「제곱해서 25가 되는 양수는 5」처럼 말한다.',
  'middle-1': '문자를 쓴 방정식의 이항, 제곱근, 피타고라스 정리는 아직 배우지 않았다.',
};

export const solutionSystem = `${writingGuide}

---

## 이번 일: 이미 발행된 문제의 해설 쓰기

지문·보기·정답·힌트는 이미 정해져 있고 바꿀 수 없다. 해설만 쓴다. 해설은 학습자가 답을 낸 뒤에 읽는다 — 맞혔든 틀렸든.

- 해설을 따라 읽으면 정답에 도달해야 한다. **마지막 문장에서 정답을 분명히 말한다.**
- 예상 오답이 주어지면, 그 값이 **어떤 잘못된 계산에서 나오는지** 계산으로 보여 주고 무엇이 틀렸는지 말한다. 이름표를 그대로 옮겨 적지 말고 학습자가 한 계산으로 말한다.
- 수업이 쓰는 말과 같은 말을 쓴다(아래 「수업의 정리」). 수업에 없는 새 공식이나 요령을 들이지 않는다.
- 보기는 번호나 기호로 가리키지 않는다. 화면이 보기 순서를 섞는다. 보기는 내용으로 가리킨다.
- 「~예요」「~해요」로 쓴다. 「~습니다」를 섞지 않는다.
- 수식은 $...$로 감싼다. 수식 안에 한글을 넣지 않는다 — 단위와 조사는 수식 밖에 둔다.
- 그림이 없는 문제다. 지문에 없는 그림·점·이름을 지어내지 않는다.
- 한 문단, 3~5문장. 같은 답을 다른 방법으로 다시 풀지 않는다.`;

export type ProblemForExplanation = {
  problemVersionId: string;
  prompt: string;
  options: string[];
  spec: AnswerSpec;
  hints: string[];
  misreadings: { answer: string; misconception: string | null }[];
  course: { title: string; stage: CourseStage | null };
  lesson: { title: string; concepts: string[]; summary: string } | null;
};

/** The answer as a writer is told it. A picked answer is the option's words, since the order is shuffled. */
const answerLine = (spec: AnswerSpec) => (spec.kind === 'choice'
  ? `「${spec.options.find((option) => option.id === spec.correct)?.text ?? ''}」인 보기`
  : spec.kind === 'rational' ? `$\\frac{${spec.numerator}}{${spec.denominator}}$${spec.requiredForm === 'reduced_fraction' ? '(기약분수로)' : ''}` : answerText(spec));

/** The one request a writer gets for a question. Same text for every writer, in the same order. */
export function solutionRequest(problem: ProblemForExplanation): string {
  const lines = [
    `코스: ${problem.course.title}${problem.course.stage ? ` (${courseStageLabels[problem.course.stage]})` : ''}`,
    ...(problem.lesson ? [`수업: ${problem.lesson.title}`, `가르치는 개념: ${problem.lesson.concepts.join(', ')}`] : []),
    ...(problem.course.stage && notYet[problem.course.stage] ? [`학년 범위: ${notYet[problem.course.stage]}`] : []),
    '',
    `지문: ${problem.prompt}`,
    ...(problem.options.length ? [`보기(순서는 화면이 섞는다): ${problem.options.map((option) => `「${option}」`).join(' ')}`] : []),
    `정답: ${answerLine(problem.spec)}`,
    ...(problem.hints.length ? [`힌트: ${problem.hints.join(' / ')}`] : []),
  ];
  if (problem.misreadings.length) {
    lines.push('예상 오답:');
    for (const item of problem.misreadings) {
      const record = item.misconception ? misconceptionOf(item.misconception) : undefined;
      lines.push(`- ${item.answer}${record ? ` — ${record.label}` : ''}`);
    }
  }
  if (problem.lesson?.summary) lines.push('', `수업의 정리: ${problem.lesson.summary}`);
  return lines.join('\n');
}

export type SolutionIssue = { code: string; message: string };

const stripMath = (text: string) => text.replace(/\$[^$]*\$/g, ' ');
const mathOf = (text: string) => [...text.matchAll(/\$([^$]+)\$/g)].map((match) => match[1]);
/** The answer as it would appear in a sentence: the number, the fraction either way, or the option's words. */
function answerAppears(text: string, spec: AnswerSpec): boolean {
  const flat = text.replace(/\s+/g, '');
  if (spec.kind === 'integer') return new RegExp(`(^|[^0-9.])${String(spec.value).replace('-', '-?')}([^0-9.]|$)`).test(flat);
  if (spec.kind === 'rational') {
    const { numerator: n, denominator: d } = spec;
    return flat.includes(`\\frac{${n}}{${d}}`) || flat.includes(`${n}/${d}`) || (d === 1 && flat.includes(String(n)));
  }
  if (spec.kind === 'choice') {
    const correct = spec.options.find((option) => option.id === spec.correct)?.text ?? '';
    const words = correct.replace(/\$/g, '').replace(/\s+/g, '');
    return !!words && flat.replace(/\$/g, '').includes(words);
  }
  return true;
}

/**
 * What can be checked without a reader. None of these says the explanation is good — that is what
 * the comparison is for — but each says something a reader should not have to find.
 */
export function checkSolution(text: string, problem: ProblemForExplanation): SolutionIssue[] {
  const issues: SolutionIssue[] = [];
  if (!text.trim()) return [{ code: 'empty', message: '해설이 비었어요.' }];
  if (!answerAppears(text, problem.spec)) issues.push({ code: 'answer-missing', message: '정답을 말하지 않았어요.' });
  if ((text.match(/\$/g)?.length ?? 0) % 2) issues.push({ code: 'math-unclosed', message: '$로 연 수식을 닫지 않았어요.' });
  for (const math of mathOf(text)) {
    if (/[가-힣]/.test(math)) { issues.push({ code: 'hangul-in-math', message: `수식 안에 한글이 있어요: ${math}` }); break; }
    try { katex.renderToString(math, { throwOnError: true }); }
    catch { issues.push({ code: 'math-error', message: `그려지지 않는 수식이 있어요: ${math}` }); break; }
  }
  const prose = stripMath(text);
  // 「보기 가」「보기 나가」「보기 2」 — one letter standing as a label after 보기, perhaps with a
  // particle, never a word that only starts like one (「보기는」, 「보기 가운데」).
  if (/[①②③④⑤]|보기\s*[a-dA-D1-5](?![a-zA-Z0-9])|보기\s+[가나다라](?:[가이는을를의와과도]|(?![가-힣]))|\([a-d]\)/.test(prose)) issues.push({ code: 'option-label', message: '보기를 번호나 기호로 가리켰어요.' });
  if (/(습니다|합니다|입니다|됩니다)(?=[.\s]|$)/.test(prose)) issues.push({ code: 'formal', message: '「~습니다」가 섞였어요.' });
  if (problem.course.stage === 'middle-2' && /\\sqrt|√|무리수/.test(text)) issues.push({ code: 'beyond-stage', message: '중2가 아직 배우지 않은 제곱근을 썼어요.' });
  if (text.length > 900) issues.push({ code: 'long', message: `길어요(${text.length}자).` });
  return issues;
}
