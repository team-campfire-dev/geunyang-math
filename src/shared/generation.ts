import { nextProblemVersionId, renameProblem, type DraftProblem } from './authoring';

/**
 * Questions a model writes for an author, and what the server found when it checked them.
 *
 * Nothing here is saved by the server. A generated question reaches the draft only when the author
 * puts it there, the same way a question they wrote by hand does — and from there it is frozen into
 * a version at publication like any other, so a learner's wrong answer to it keeps its meaning.
 */
export type GenerationForm = 'choice' | 'written' | 'mixed';
export const generationLimits = { maxCount: 6, maxNote: 400, maxExisting: 30, maxExistingText: 200, maxMisconceptions: 6 } as const;

/** What the author asks for. The lesson, its course and its concepts the server reads from the draft. */
export type GenerationRequest = {
  conceptKeys: string[];
  /** Mistakes the questions should be built to catch. Empty lets the writer choose from the catalogue. */
  misconceptions: string[];
  count: number;
  form: GenerationForm;
  /** Anything else the author wants said, in their words. */
  note: string;
  /** The questions already beside these, so the new ones neither repeat them nor share their answers. */
  existing: { prompt: string; answer: string }[];
  /**
   * Wrong answers a learner actually wrote, when the questions are for them: what was asked, what
   * they wrote, and what the answer was. The editor never sends these; the learning service does.
   */
  mistakes?: { prompt: string; wrote: string; answer: string }[];
};

export type GenerationVerdict = 'verified' | 'unverified' | 'rejected';
export type GenerationIssue = { code: string; level: 'error' | 'unverified' | 'warning'; message: string; option?: string; answer?: string };

/**
 * One question as it came back. `problem` is in the editor's own shape with a placeholder name; the
 * editor names it when the author takes it. `claim` is what the writer said the question computes,
 * and `independent` what a second request answered from the prompt alone.
 */
export type GeneratedProblem = {
  problem: DraftProblem;
  verdict: GenerationVerdict;
  strength?: string;
  computed?: string;
  claim: string;
  independent?: string;
  issues: GenerationIssue[];
};
/** `asked` is how many were asked for: a writer can send fewer, and the author should hear so. */
export type GenerationResult = { problems: GeneratedProblem[]; asked: number; model: string };

/** A rejected question is wrong for certain, so there is nothing for an author to decide about it. */
export const mayTake = (generated: GeneratedProblem) => generated.verdict !== 'rejected';

/**
 * A generated question as one of this draft's own. It comes back under a placeholder name, because
 * only the editor knows which names the document has taken since it was last saved.
 */
export function takeGenerated(generated: GeneratedProblem, lessonKey: string, role: string, versionId: string, taken: string[]): DraftProblem {
  return renameProblem(structuredClone(generated.problem), nextProblemVersionId(lessonKey, role, versionId, taken));
}

/**
 * What each finding means, for someone writing a lesson. The checker's own words are English and
 * name its internals; the editor shows those only in expert mode.
 */
export const generationIssueText: Record<string, string> = {
  'claim-invalid': '이 문제가 묻는 계산을 읽을 수 없었어요.',
  'claim-failed': '이 문제가 묻는 계산을 서버가 끝까지 하지 못했어요.',
  'claim-ill-posed': '문제가 하나의 답을 묻는데 답이 여럿이거나 없어요.',
  'claim-shape': '주관식인데 계산이 값 하나로 끝나지 않아요.',
  'answer-mismatch': '정답이 계산한 값과 달라요.',
  'answer-unaccepted': '채점기가 정답을 쓴 그대로 맞다고 하지 않아요.',
  'choice-invalid': '보기의 모양이 발행할 수 없는 상태예요.',
  'choice-no-match': '계산한 값과 같은 보기가 없어요.',
  'choice-ambiguous': '계산한 값과 같은 보기가 둘 이상이에요.',
  'choice-wrong-key': '정답과 같은 보기는 있는데, 정답으로 고른 보기가 달라요.',
  'option-unreadable': '읽지 못한 보기가 있어서 그 보기가 정답일 가능성을 지우지 못했어요.',
  'option-units': '보기마다 단위가 달라서 값을 비교하지 않았어요.',
  'claim-degrees': '정답이 각을 도(°)로 센 수예요. 맞을 수 있지만 사람이 확인해야 해요.',
  'misreading-invalid': '예상 오답의 이름표가 규칙에 맞지 않아요.',
  'misreading-correct': '예상 오답이 정답으로 채점돼요.',
  'misreading-unrecordable': '입력 칸이 예상 오답을 받지 않아서 그 실수가 기록될 수 없어요.',
  'misreading-shadowed': '같은 값에 다른 이름표가 먼저 붙어서 이 이름으로 기록되지 않아요.',
  'misreading-derivation': '예상 오답과 함께 낸 잘못된 계산이 그 값에 닿지 않아요.',
  'misreading-unchecked': '예상 오답의 잘못된 계산을 확인하지 못했어요.',
  'misreading-dropped': '입력 칸이 받지 않는 예상 오답이 있어서 그 이름표는 뺐어요.',
  'independent-disagrees': '지문만 보고 따로 푼 답이 정답과 달라요. 지문이 다른 것을 묻고 있을 수 있어요.',
  'independent-missing': '지문만 보고 따로 푸는 단계가 답을 내지 못했어요.',
  'prompt-numbers': '계산에 지문에 없는 수가 쓰였어요.',
  'claim-trivial': '계산이 답을 다시 적었을 뿐이라, 따로 푼 답 말고는 대조할 것이 없었어요.',
  'claim-note': '쓰인 계산 대신 다른 길로 계산해 대조했어요.',
  'output-invalid': '문제의 모양이 편집기가 받을 수 없는 형태로 왔어요.',
};
export const generationIssueLabel = (issue: Pick<GenerationIssue, 'code'>) => generationIssueText[issue.code] ?? issue.code;
export const generationVerdictLabels: Record<GenerationVerdict, string> = {
  verified: '검증됨', unverified: '확인 필요', rejected: '틀림',
};
