import 'server-only';
import type { StoredProblem } from './content';

// Immutable placement bank, separate from lessons/checks/homework. Publish a new version to change it.
// Placement is provisional; this is not a validated assessment of mathematical ability.
export const diagnosticVersion = 'fraction-placement-v1';
function item(key: string, skillKey: string, prompt: string, gradingSpec: StoredProblem['gradingSpec']): StoredProblem {
  const problemVersionId = `${diagnosticVersion}:${key}`;
  return { problemVersionId, skillKeys: [skillKey],
    promptContent: [{ blockId: `${problemVersionId}:prompt`, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: prompt } }],
    responseSpec: { kind: gradingSpec.kind, ...(gradingSpec.requiredForm ? { requiredForm: gradingSpec.requiredForm } : {}) },
    gradingSpec, hintAvailable: false, hints: [], solution: [] };
}
export const diagnosticProblems: StoredProblem[] = [
  item('meaning-1', 'fraction.meaning', '같은 크기로 나눈 케이크 9조각 중 4조각이 남았어요. 전체 케이크에서 남은 양을 분수로 써 주세요.', { kind: 'rational', numerator: 4, denominator: 9 }),
  item('meaning-2', 'fraction.meaning', '5/12에서 전체를 같은 크기로 나눈 조각 수를 나타내는 수는 무엇인가요?', { kind: 'integer', value: 12 }),
  item('equivalence-1', 'fraction.equivalence', '2/3 = □/15가 되도록 빈칸에 들어갈 정수를 써 주세요.', { kind: 'integer', value: 10 }),
  item('equivalence-2', 'fraction.equivalence', '18/24를 더 이상 약분할 수 없는 분수로 써 주세요. 분모는 양수로 써 주세요.', { kind: 'rational', numerator: 3, denominator: 4, requiredForm: 'reduced_fraction' }),
  item('addition-1', 'fraction.addition', '2/11 + 5/11은 얼마인가요?', { kind: 'rational', numerator: 7, denominator: 11 }),
  item('addition-2', 'fraction.addition', '1/4 + 1/6을 더 이상 약분할 수 없는 분수로 써 주세요. 분모는 양수로 써 주세요.', { kind: 'rational', numerator: 5, denominator: 12, requiredForm: 'reduced_fraction' }),
];
