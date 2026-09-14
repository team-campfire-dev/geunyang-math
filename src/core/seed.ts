import 'server-only';

import type { ClassSection, ContentBlock } from '@/shared/api';
import { type StoredClass, type StoredProblem, validateClass } from './content';

// Starter content for product validation. A subject expert still needs to review it before a public launch.
export const skillLabels: Record<string, string> = {
  'fraction.meaning': '분수의 의미',
  'fraction.equivalence': '동치분수와 약분',
  'fraction.addition': '분수의 덧셈',
};

function text(blockId: string, value: string): ContentBlock {
  return { blockId, kind: 'core.rich_text', typeVersion: 1, required: true, payload: { text: value } };
}

function strip(blockId: string, parts: number, filled: number, label: string): ContentBlock {
  return { blockId, kind: 'math.fraction_strip', typeVersion: 1, required: true, payload: { parts, filled, label } };
}

function problem(
  classKey: string,
  key: string,
  skillKey: string,
  prompt: string,
  gradingSpec: StoredProblem['gradingSpec'],
  hint: string,
  solution: string,
): StoredProblem {
  const problemVersionId = `${classKey}:${key}:v1`;
  return {
    problemVersionId,
    skillKeys: [skillKey],
    promptContent: [text(`${problemVersionId}:prompt`, prompt)],
    responseSpec: { kind: gradingSpec.kind, ...(gradingSpec.requiredForm ? { requiredForm: gradingSpec.requiredForm } : {}) },
    hintAvailable: true,
    gradingSpec,
    hints: [text(`${problemVersionId}:hint`, hint)],
    solution: [text(`${problemVersionId}:solution`, solution)],
  };
}

function section(classKey: string, role: ClassSection['role'], title: string, contentBlocks: ContentBlock[]): ClassSection {
  return { sectionId: `${classKey}:${role}:v1`, role, title, contentBlocks };
}

function problemSet(classKey: string, role: 'practice' | 'check', problems: StoredProblem[]): ContentBlock {
  return {
    blockId: `${classKey}:${role}:problems:v1`, kind: 'core.problem_set', typeVersion: 1, required: true,
    payload: { problemVersionIds: problems.map((item) => item.problemVersionId) },
  };
}

const meaningKey = 'fraction-meaning';
const meaningProblems = [
  problem(meaningKey, 'practice-1', 'fraction.meaning',
    '식빵 한 장을 같은 크기의 4조각으로 나눴어요. 그중 1조각을 먹었다면, 먹은 양은 전체의 얼마인가요? 분수로 입력해 보세요.',
    { kind: 'rational', numerator: 1, denominator: 4 },
    '분모에는 전체를 나눈 조각 수를, 분자에는 먹은 조각 수를 써요.',
    '전체가 같은 크기의 4조각이고 먹은 것은 1조각이므로 1/4이에요.'),
  problem(meaningKey, 'practice-2', 'fraction.meaning',
    '3/7에서 분모는 어떤 수인가요? 숫자 하나로 입력해 보세요.',
    { kind: 'integer', value: 7 },
    '분수에서 가로선 아래의 수가 분모예요. 전체를 같은 크기로 몇 조각 나누었는지 나타내요.',
    '분모는 7이에요. 3/7은 전체를 같은 크기로 7조각 나눈 것 중 3조각을 뜻해요.'),
  problem(meaningKey, 'check-1', 'fraction.meaning',
    '물 한 병을 같은 양의 8컵에 나눠 담았어요. 그중 5컵의 물은 원래 한 병의 얼마인가요?',
    { kind: 'rational', numerator: 5, denominator: 8 },
    '한 병 전체가 8개의 같은 단위로 나뉘었고, 그중 5개를 골랐어요.',
    '같은 양의 8컵 중 5컵이므로 한 병의 5/8이에요.'),
  problem(meaningKey, 'homework-1', 'fraction.meaning',
    '같은 크기로 나눈 초콜릿 6조각 중 5조각이 남아 있어요. 남은 양은 초콜릿 전체의 얼마인가요?',
    { kind: 'rational', numerator: 5, denominator: 6 },
    '남아 있는 조각 수와 처음의 전체 조각 수를 구분해 보세요.',
    '전체 6조각 중 5조각이 남았으므로 5/6이에요.'),
  problem(meaningKey, 'homework-2', 'fraction.meaning',
    '한 시간을 같은 길이의 10구간으로 나눴어요. 그중 3구간을 공부했다면, 공부한 시간은 한 시간의 얼마인가요?',
    { kind: 'rational', numerator: 3, denominator: 10 },
    '전체 구간 수가 분모, 공부한 구간 수가 분자예요.',
    '같은 길이의 10구간 중 3구간이므로 3/10시간이에요.'),
];

const meaning: StoredClass = {
  public: {
    classKey: meaningKey, versionId: `${meaningKey}:v1`, title: '분수, 전체와 조각의 관계',
    summary: '일상의 나누기에서 시작해 분자와 분모의 뜻을 다시 익혀요.',
    estimatedMinutes: 12, skillKeys: ['fraction.meaning'], prerequisiteSkillKeys: [], sectionCount: 5, order: 1,
  },
  sections: [
    section(meaningKey, 'explanation', '같은 크기로 나눈다는 것', [
      text(`${meaningKey}:explanation:text:v1`, '분수는 전체와 부분의 관계를 나타내요. 먼저 무엇을 전체 1로 볼지 정하고, 그것을 같은 크기로 나눠요.\n\n3/4는 전체를 같은 크기의 4조각으로 나눈 뒤 3조각을 고른 양이에요. 아래의 4는 분모, 위의 3은 분자예요. 조각 크기가 서로 다르면 조각 개수만으로 분수를 정할 수 없어요.'),
      { blockId: `${meaningKey}:explanation:figure:v1`, kind: 'core.figure', typeVersion: 1, required: true,
        payload: { alt: '전체를 같은 크기 4칸으로 나누고 3칸을 채운 막대', caption: '같은 크기의 4칸 중 3칸 = 3/4', primitive: { kind: 'fraction_strip', parts: 4, filled: 3, label: '3/4' } } },
    ]),
    section(meaningKey, 'worked_example', '함께 보기: 초콜릿 한 판', [
      text(`${meaningKey}:example:text:v1`, '초콜릿 한 판을 같은 크기의 5조각으로 나눴고 2조각을 먹었어요.\n\n① 전체는 초콜릿 한 판이에요.\n② 전체를 5조각으로 나눴으니 분모는 5예요.\n③ 먹은 것은 2조각이니 분자는 2예요.\n따라서 먹은 양은 한 판의 2/5예요. 남은 양은 3/5이고, 둘을 합치면 한 판이에요.'),
      strip(`${meaningKey}:example:strip:v1`, 5, 2, '먹은 양 2/5'),
    ]),
    section(meaningKey, 'practice', '직접 풀어 보기', [problemSet(meaningKey, 'practice', meaningProblems.slice(0, 2))]),
    section(meaningKey, 'check', '혼자 확인하기', [problemSet(meaningKey, 'check', meaningProblems.slice(2, 3))]),
    section(meaningKey, 'summary', '오늘 기억할 두 가지', [
      text(`${meaningKey}:summary:text:v1`, '분모는 전체를 같은 크기로 나눈 조각 수, 분자는 그중 고른 조각 수예요. 전체가 무엇인지와 조각 크기가 같은지를 먼저 확인해요.\n\n수업을 마치면 복습 과제가 생겨요. 오늘의 풀이와 별도로 기록되며, 다음 날 다시 풀어 보면 기억을 확인하는 데 도움이 돼요.'),
    ]),
  ],
  problems: meaningProblems,
  homeworkProblemIds: meaningProblems.slice(3).map((item) => item.problemVersionId),
};

const equivalenceKey = 'fraction-equivalence';
const equivalenceProblems = [
  problem(equivalenceKey, 'practice-1', 'fraction.equivalence',
    '1/2과 크기가 같은 분수를 □/8로 쓰려고 해요. □에 들어갈 정수를 입력해 보세요.',
    { kind: 'integer', value: 4 },
    '분모 2에 어떤 수를 곱하면 8이 되나요? 분자에도 같은 수를 곱해요.',
    '분모를 2 × 4 = 8로 바꿨으니 분자도 1 × 4 = 4예요. 1/2 = 4/8이에요.'),
  problem(equivalenceKey, 'practice-2', 'fraction.equivalence',
    '6/9를 더 이상 약분할 수 없는 분수로 써 보세요. 분모는 양수로 써 주세요.',
    { kind: 'rational', numerator: 2, denominator: 3, requiredForm: 'reduced_fraction' },
    '6과 9를 모두 나눌 수 있는 가장 큰 자연수를 찾아 보세요.',
    '6과 9를 모두 3으로 나누면 2/3이에요. 2와 3은 1 이외의 공약수가 없어 더 약분할 수 없어요.'),
  problem(equivalenceKey, 'check-1', 'fraction.equivalence',
    '10/14를 더 이상 약분할 수 없는 분수로 써 보세요. 분모는 양수로 써 주세요.',
    { kind: 'rational', numerator: 5, denominator: 7, requiredForm: 'reduced_fraction' },
    '분자와 분모를 같은 수로 나눠야 크기가 그대로 유지돼요. 10과 14의 공약수를 찾아 보세요.',
    '분자와 분모를 2로 나누면 10 ÷ 2 = 5, 14 ÷ 2 = 7이므로 5/7이에요.'),
  problem(equivalenceKey, 'homework-1', 'fraction.equivalence',
    '3/4 = □/12가 되도록 □에 들어갈 정수를 입력해 보세요.',
    { kind: 'integer', value: 9 },
    '분모 4가 12가 되려면 3배가 되어야 해요. 분자에도 같은 규칙을 적용해요.',
    '분자와 분모에 3을 곱하면 3/4 = 9/12예요. 빈칸은 9예요.'),
  problem(equivalenceKey, 'homework-2', 'fraction.equivalence',
    '12/20을 더 이상 약분할 수 없는 분수로 써 보세요. 분모는 양수로 써 주세요.',
    { kind: 'rational', numerator: 3, denominator: 5, requiredForm: 'reduced_fraction' },
    '12와 20을 모두 나눌 수 있는 수로 나눠 보세요. 한 번 더 나눌 수 있는지도 확인해요.',
    '12와 20을 4로 나누면 3/5가 돼요. 3과 5에는 1 이외의 공약수가 없어요.'),
];

const equivalence: StoredClass = {
  public: {
    classKey: equivalenceKey, versionId: `${equivalenceKey}:v1`, title: '모양이 달라도 같은 분수',
    summary: '동치분수와 약분을 익히고, 같은 양을 다른 조각으로 표현해요.',
    estimatedMinutes: 15, skillKeys: ['fraction.equivalence'], prerequisiteSkillKeys: ['fraction.meaning'], sectionCount: 5, order: 2,
  },
  sections: [
    section(equivalenceKey, 'explanation', '조각 수가 달라도 양은 그대로', [
      text(`${equivalenceKey}:explanation:text:v1`, '같은 전체를 기준으로 1/2과 2/4는 같은 양이에요. 반쪽 하나를 다시 둘로 나누면, 조각은 두 개가 되지만 실제 양은 그대로예요. 이렇게 크기가 같은 분수를 동치분수라고 해요.\n\n분자와 분모에 같은 0이 아닌 수를 곱하거나 나누면 분수의 값은 변하지 않아요. 분자와 분모를 공통된 자연수로 나누어 간단히 만드는 것을 약분이라고 해요.'),
      strip(`${equivalenceKey}:explanation:half:v1`, 2, 1, '1/2'),
      strip(`${equivalenceKey}:explanation:quarters:v1`, 4, 2, '2/4 — 같은 전체에서 같은 양'),
    ]),
    section(equivalenceKey, 'worked_example', '함께 보기: 4/6을 간단하게', [
      text(`${equivalenceKey}:example:text:v1`, '4/6을 약분해 볼게요.\n\n① 4와 6은 모두 2로 나누어떨어져요.\n② 분자와 분모를 함께 2로 나누면 (4 ÷ 2)/(6 ÷ 2) = 2/3이에요.\n③ 2와 3은 1 이외의 공약수가 없으므로 여기서 마쳐요.\n\n4/6과 2/3은 같은 값이지만, “더 이상 약분할 수 없는 분수”를 요구하는 문제에서는 2/3으로 써야 해요.'),
      strip(`${equivalenceKey}:example:strip:v1`, 6, 4, '4/6 = 2/3'),
    ]),
    section(equivalenceKey, 'practice', '같은 양을 다르게 쓰기', [problemSet(equivalenceKey, 'practice', equivalenceProblems.slice(0, 2))]),
    section(equivalenceKey, 'check', '약분 혼자 확인하기', [problemSet(equivalenceKey, 'check', equivalenceProblems.slice(2, 3))]),
    section(equivalenceKey, 'summary', '분자와 분모는 함께 바꿔요', [
      text(`${equivalenceKey}:summary:text:v1`, '분자와 분모에 같은 수를 곱하거나 나누면 크기가 같은 분수가 돼요. 한쪽만 바꾸면 일반적으로 값이 달라져요.\n\n약분한 뒤 분자와 분모를 함께 나눌 수 있는 1보다 큰 자연수가 없는지 확인해요. 값이 맞는 것과 문제에서 요구한 모양으로 쓰는 것은 모두 중요해요.'),
    ]),
  ],
  problems: equivalenceProblems,
  homeworkProblemIds: equivalenceProblems.slice(3).map((item) => item.problemVersionId),
};

const additionKey = 'fraction-addition';
const additionProblems = [
  problem(additionKey, 'practice-1', 'fraction.addition',
    '1/7 + 3/7은 얼마인가요?',
    { kind: 'rational', numerator: 4, denominator: 7 },
    '조각 크기가 이미 같아요. 1/7 조각이 모두 몇 개가 되는지 세어 보세요.',
    '1/7 조각 1개와 3개를 합치면 4개예요. 분모는 그대로 두어 4/7이에요.'),
  problem(additionKey, 'practice-2', 'fraction.addition',
    '1/2 + 1/4은 얼마인가요?',
    { kind: 'rational', numerator: 3, denominator: 4 },
    '1/2를 분모가 4인 동치분수로 바꾸면, 같은 크기의 조각끼리 더할 수 있어요.',
    '1/2 = 2/4이므로 2/4 + 1/4 = 3/4이에요.'),
  problem(additionKey, 'check-1', 'fraction.addition',
    '1/3 + 1/6을 계산하고, 더 이상 약분할 수 없는 분수로 써 보세요. 분모는 양수로 써 주세요.',
    { kind: 'rational', numerator: 1, denominator: 2, requiredForm: 'reduced_fraction' },
    '먼저 두 분수를 분모 6으로 맞춰요. 더한 뒤 약분할 수 있는지 확인해요.',
    '1/3 = 2/6이므로 2/6 + 1/6 = 3/6이에요. 3으로 약분하면 1/2이에요.'),
  problem(additionKey, 'homework-1', 'fraction.addition',
    '2/9 + 4/9를 계산하고, 더 이상 약분할 수 없는 분수로 써 보세요. 분모는 양수로 써 주세요.',
    { kind: 'rational', numerator: 2, denominator: 3, requiredForm: 'reduced_fraction' },
    '분모가 같으므로 분자를 더해요. 계산 결과를 다시 약분해 보세요.',
    '2/9 + 4/9 = 6/9이고, 분자와 분모를 3으로 나누면 2/3이에요.'),
  problem(additionKey, 'homework-2', 'fraction.addition',
    '물을 3/4리터 마시고 1/8리터 더 마셨어요. 모두 몇 리터를 마셨나요? 더 이상 약분할 수 없는 분수로 써 보세요.',
    { kind: 'rational', numerator: 7, denominator: 8, requiredForm: 'reduced_fraction' },
    '3/4을 분모가 8인 분수로 바꾸고 1/8을 더해요.',
    '3/4 = 6/8이므로 6/8 + 1/8 = 7/8리터예요. 7/8은 더 약분할 수 없어요.'),
];

const addition: StoredClass = {
  public: {
    classKey: additionKey, versionId: `${additionKey}:v1`, title: '분수 더하기, 조각 크기 맞추기',
    summary: '동치분수로 분모를 맞추고, 일상의 양을 더해 봐요.',
    estimatedMinutes: 18, skillKeys: ['fraction.addition'], prerequisiteSkillKeys: ['fraction.meaning', 'fraction.equivalence'], sectionCount: 5, order: 3,
  },
  sections: [
    section(additionKey, 'explanation', '더하려면 단위가 같아야 해요', [
      text(`${additionKey}:explanation:text:v1`, '분수를 더할 때는 같은 전체를 기준으로 조각 크기를 맞춰요. 분모가 같으면 조각 크기가 같으므로 분자만 더해요. 예를 들어 1/5 + 2/5 = 3/5예요.\n\n분모가 다르면 동치분수로 바꾸어 분모를 같게 만들어요. 이것을 통분이라고 해요. 1/2 + 1/3에서 분모끼리 더해 2/5로 쓰면 안 돼요. 반 조각과 삼분의 일 조각은 크기가 다르기 때문이에요.'),
      strip(`${additionKey}:explanation:strip:v1`, 5, 3, '1/5 조각 1개 + 2개 = 3개'),
    ]),
    section(additionKey, 'worked_example', '함께 보기: 1/2컵과 1/3컵', [
      text(`${additionKey}:example:text:v1`, '같은 계량컵으로 물 1/2컵과 1/3컵을 합쳐 볼게요.\n\n① 2와 3의 공통 배수인 6을 분모로 정해요.\n② 1/2 = 3/6, 1/3 = 2/6으로 바꿔요.\n③ 같은 크기의 1/6컵 조각을 세면 3개 + 2개 = 5개예요.\n④ 따라서 1/2 + 1/3 = 5/6컵이에요.\n\n분모는 조각의 크기를 나타내므로 그대로 두고 분자끼리 더해요.'),
      strip(`${additionKey}:example:strip:v1`, 6, 5, '3/6 + 2/6 = 5/6'),
    ]),
    section(additionKey, 'practice', '조각 크기를 맞춰서 더하기', [problemSet(additionKey, 'practice', additionProblems.slice(0, 2))]),
    section(additionKey, 'check', '통분과 약분 혼자 확인하기', [problemSet(additionKey, 'check', additionProblems.slice(2, 3))]),
    section(additionKey, 'summary', '통분 → 덧셈 → 약분', [
      text(`${additionKey}:summary:text:v1`, '① 같은 전체를 기준으로 생각해요.\n② 분모가 다르면 통분해 조각 크기를 맞춰요.\n③ 분모는 그대로 두고 분자를 더해요.\n④ 더 이상 약분할 수 없는지 확인해요.\n\n틀린 문제는 힌트와 함께 다시 풀어도 괜찮아요. 힌트를 본 풀이와 혼자 푼 풀이는 구분해 기록해요.'),
    ]),
  ],
  problems: additionProblems,
  homeworkProblemIds: additionProblems.slice(3).map((item) => item.problemVersionId),
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

export const seedClasses: StoredClass[] = [meaning, equivalence, addition];
for (const record of seedClasses) validateClass(record);
deepFreeze(seedClasses);
deepFreeze(skillLabels);
