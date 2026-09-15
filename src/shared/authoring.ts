// Shared by the authoring API and the editor screen. Field descriptions live here so the editor can
// offer a form for every published block kind without importing the server's validation schemas,
// and so the server can prune the same optional fields before it validates what the editor sent.
import type { AnswerSpec } from './answer';
import type { ClassSection, ContentBlock, PublicProblem } from './api';

/** A role on an account, not a property of one operator: a teacher system grants the same roles. */
export type AuthoringRole = 'admin' | 'author';
export const mayPublish = (role: AuthoringRole | null) => role === 'admin';
export const mayEditEveryDraft = (role: AuthoringRole | null) => role === 'admin';
/** Handing content work to another account is the same authority as publishing what it writes. */
export const mayGrantRoles = (role: AuthoringRole | null) => role === 'admin';

/**
 * An account as the role panel shows it. `source` says where a role came from: a row an
 * administrator wrote, or the environment that names a new deployment's first administrators.
 * An environment-named role is not a row, so this screen can show it but cannot take it back.
 */
export type AccountRole = {
  userId: string; displayName: string; role: AuthoringRole | null;
  source: 'granted' | 'environment' | 'none'; grantedAt: string | null; me: boolean;
};

export type DraftSummary = {
  id: string; classKey: string; versionId: string; baseVersionId: string | null; title: string;
  status: 'draft' | 'published'; publishedVersionId: string | null; updatedAt: string;
  authorName: string; mine: boolean;
};
export type DraftMeta = { versionId: string; title: string; summary: string; estimatedMinutes: number };
/**
 * A question as the editor holds it. Answers, hints and solutions belong to the draft, so this
 * reaches a browser only where the account holds a content role. `responseSpec` and `hintAvailable`
 * follow from the answer and the hints, so an editor never states the same thing twice and the two
 * halves cannot drift apart.
 */
export type DraftProblem = {
  problemVersionId: string;
  skillKeys: string[];
  promptContent: ContentBlock[];
  gradingSpec: AnswerSpec;
  hints: ContentBlock[];
  solution: ContentBlock[];
};
/** What an editor may change. Published questions are immutable, so the server renames what changed. */
export type DraftEdit = { meta: DraftMeta; sections: ClassSection[]; problems: DraftProblem[] };
/** `skillKeys` are the class's own, carried so a question may only claim a concept the class teaches. */
export type DraftDetail = DraftSummary & { edit: DraftEdit; skillKeys: string[]; issues: string[] };

export const responseSpecOf = (spec: AnswerSpec): PublicProblem['responseSpec'] =>
  (spec.kind === 'rational' && spec.requiredForm ? { kind: 'rational', requiredForm: spec.requiredForm } : { kind: spec.kind });
/** The half of a question a learner may see. The preview reads questions the way the lesson will. */
export const toPublicProblem = (problem: DraftProblem): PublicProblem => ({
  problemVersionId: problem.problemVersionId, skillKeys: [...problem.skillKeys],
  promptContent: problem.promptContent, responseSpec: responseSpecOf(problem.gradingSpec),
  hintAvailable: problem.hints.length > 0,
});
export type ClassChoice = { classKey: string; title: string; latestVersionId: string; suggestedVersionId: string; hasDraft: boolean };
export type AuthoringWorkspace = { role: AuthoringRole | null; drafts: DraftSummary[]; classes: ClassChoice[]; accounts: AccountRole[] };
export type AuthoringAction =
  | { action: 'draft.create'; classKey: string }
  | { action: 'draft.save'; draftId: string; edit: DraftEdit }
  | { action: 'draft.validate'; draftId: string }
  | { action: 'draft.publish'; draftId: string }
  | { action: 'draft.delete'; draftId: string }
  | { action: 'account.search'; query: string }
  | { action: 'role.grant'; userId: string; role: AuthoringRole }
  | { action: 'role.revoke'; userId: string };
export type AuthoringResponse = {
  workspace: AuthoringWorkspace; draft?: DraftDetail; publishedVersionId?: string; matches?: AccountRole[];
};

const versionSuffix = /:v(\d+)$/;
/** Generated names end in the version they were written for, the way published records read. */
const suffixOf = (versionId: string) => (versionSuffix.test(versionId) ? versionId.slice(versionId.lastIndexOf(':') + 1) : 'v1');
/** Published versions are immutable, so every edit becomes the next version of the same class. */
export function suggestVersionId(classKey: string, existing: string[]): string {
  const numbers = existing.map((id) => versionSuffix.exec(id)).filter((match) => match !== null).map((match) => Number(match[1]));
  return `${classKey}:v${Math.max(0, ...numbers) + 1}`;
}

/** Block IDs only need to be unique inside one document; the shape follows the published records. */
export function nextBlockId(classKey: string, sectionId: string, kind: string, versionId: string, taken: string[]): string {
  const role = sectionId.split(':')[1] ?? 'section';
  const name = kind.split('.')[1] ?? 'block';
  const suffix = suffixOf(versionId);
  for (let index = 1; ; index++) {
    const id = `${classKey}:${role}:${name}${index === 1 ? '' : `-${index}`}:${suffix}`;
    if (!taken.includes(id)) return id;
  }
}

/** Blocks inside a question are named after it, so reading an ID says which question it belongs to. */
export function nextProblemBlockId(problemVersionId: string, part: 'prompt' | 'hint' | 'solution', taken: string[]): string {
  for (let index = 1; ; index++) {
    const id = `${problemVersionId}:${part}${index === 1 ? '' : `-${index}`}`;
    if (!taken.includes(id)) return id;
  }
}

/** Sections are identified the same way blocks are: readable, and unique inside one document. */
export function nextSectionId(classKey: string, role: string, versionId: string, taken: string[]): string {
  const suffix = suffixOf(versionId);
  for (let index = 1; ; index++) {
    const id = `${classKey}:${role}${index === 1 ? '' : `-${index}`}:${suffix}`;
    if (!taken.includes(id)) return id;
  }
}

/**
 * Questions are named after the activity they belong to, the way the published records are. A
 * question keeps its name as it moves between versions, so a name already in use is in use whatever
 * version it ends in: a new question takes the next name rather than the same one in a new version.
 */
export function nextProblemVersionId(classKey: string, role: string, versionId: string, taken: string[]): string {
  const suffix = suffixOf(versionId);
  const names = new Set(taken.map((id) => (versionSuffix.test(id) ? id.slice(0, id.lastIndexOf(':')) : id)));
  for (let index = 1; ; index++) {
    const name = `${classKey}:${role}-${index}`;
    if (!names.has(name)) return `${name}:${suffix}`;
  }
}

/**
 * Renames a question and the blocks named after it. A published question cannot change, so an edit
 * becomes a new one; its blocks carry the old name in theirs and would otherwise keep pointing at a
 * version this document no longer holds.
 */
export function renameProblem<T extends { problemVersionId: string; promptContent: ContentBlock[]; hints: ContentBlock[]; solution: ContentBlock[] }>(
  problem: T, problemVersionId: string,
): T {
  const rename = (blocks: ContentBlock[]) => blocks.map((block) => (block.blockId.startsWith(problem.problemVersionId)
    ? { ...block, blockId: `${problemVersionId}${block.blockId.slice(problem.problemVersionId.length)}` }
    : block));
  return { ...problem, problemVersionId,
    promptContent: rename(problem.promptContent), hints: rename(problem.hints), solution: rename(problem.solution) };
}

/**
 * The name an edited question takes. It keeps the question's own name and moves to the version being
 * written, so `practice-1:v1` edited for `:v2` reads as `practice-1:v2`; a name already spoken for
 * steps aside rather than colliding.
 */
export function renamedProblemVersionId(current: string, versionId: string, taken: (id: string) => boolean): string {
  const base = versionSuffix.test(current) ? current.slice(0, current.lastIndexOf(':')) : current;
  const suffix = suffixOf(versionId);
  for (let index = 1; ; index++) {
    const id = `${base}${index === 1 ? '' : `-${index}`}:${suffix}`;
    if (!taken(id)) return id;
  }
}

/** Every reference to a question, wherever a document may hold one. */
export function renameProblemReferences(sections: ClassSection[], renames: Map<string, string>): ClassSection[] {
  if (!renames.size) return sections;
  return sections.map((section) => ({
    ...section,
    contentBlocks: section.contentBlocks.map((block) => (block.kind === 'core.problem_set' && Array.isArray(block.payload.problemVersionIds)
      ? { ...block, payload: { ...block.payload,
          problemVersionIds: (block.payload.problemVersionIds as string[]).map((id) => renames.get(id) ?? id) } }
      : block)),
  }));
}

/** The questions one activity holds, in the order that activity names them. */
export function problemsOfBlock(block: ContentBlock, problems: DraftProblem[]): DraftProblem[] {
  const ids = Array.isArray(block.payload.problemVersionIds) ? (block.payload.problemVersionIds as string[]) : [];
  return ids.map((id) => problems.find((problem) => problem.problemVersionId === id)).filter((problem) => problem !== undefined);
}

/** A question a learner has to answer, so a new one starts with a prompt and an answer of 1/2. */
export function newProblem(problemVersionId: string, skillKeys: string[]): DraftProblem {
  return {
    problemVersionId, skillKeys: [...skillKeys],
    promptContent: [{ blockId: `${problemVersionId}:prompt`, kind: 'core.rich_text', typeVersion: 1, required: true,
      payload: { text: '여기에 문제를 씁니다.' } }],
    gradingSpec: { kind: 'rational', numerator: 1, denominator: 2 },
    hints: [],
    solution: [{ blockId: `${problemVersionId}:solution`, kind: 'core.rich_text', typeVersion: 1, required: true,
      payload: { text: '여기에 풀이를 씁니다.' } }],
  };
}

/** Reordering is the same move for blocks, for questions and for the names an activity holds. */
export function moveBlock<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export type BlockField = {
  key: string; label: string; kind: 'text' | 'multiline' | 'number' | 'boolean';
  optional?: boolean; min?: number; max?: number; hint?: string;
};
export type BlockList = { key: string; label: string; addLabel: string; max: number; fields: BlockField[]; create: () => Record<string, unknown> };
export type BlockForm = {
  kind: string; typeVersion: number; label: string; hint: string;
  fields: BlockField[]; list?: BlockList; editsProblems?: boolean; editsScene?: boolean;
  /** Published classes still hold these, so the editor can open one; nothing new is made with them. */
  retired?: boolean;
  create: () => Record<string, unknown>;
};

const altHint = '화면 낭독용 이름이에요. 수식 표기 없이 평문으로 씁니다.';
export const blockForms: BlockForm[] = [
  {
    kind: 'core.rich_text', typeVersion: 1, label: '본문', hint: '$...$ 안에 수식을 넣을 수 있어요.',
    create: () => ({ text: '여기에 설명을 씁니다.' }),
    fields: [{ key: 'text', label: '본문', kind: 'multiline' }],
  },
  {
    kind: 'core.rich_text', typeVersion: 2, label: '본문 + 용어 풀이', hint: '본문에 실제로 있는 낱말을 용어로 연결해요. 지금 배우는 개념의 용어는 서버가 알아서 숨깁니다.',
    create: () => ({ text: '여기에 설명을 씁니다.', terms: [] }),
    fields: [{ key: 'text', label: '본문', kind: 'multiline' }],
    list: {
      key: 'terms', label: '연결할 용어', addLabel: '용어 연결 추가', max: 20,
      create: () => ({ termKey: '', surface: '' }),
      fields: [
        { key: 'termKey', label: '용어 키', kind: 'text', hint: '발행된 TermVersion의 termKey' },
        { key: 'surface', label: '본문의 낱말', kind: 'text' },
        { key: 'occurrence', label: '몇 번째', kind: 'number', optional: true, min: 1, max: 100 },
      ],
    },
  },
  {
    kind: 'core.figure', typeVersion: 1, label: '그림 (옛 분수 막대)', retired: true,
    hint: '이전 판본이 쓰던 형식이에요. 새로 만들 때는 「그림」 블록 안의 분수 막대를 씁니다.',
    create: () => ({ alt: '4등분한 막대 중 3칸을 채운 그림', caption: '', primitive: { kind: 'fraction_strip', parts: 4, filled: 3 } }),
    fields: [
      { key: 'alt', label: '그림 이름', kind: 'text', hint: altHint },
      { key: 'caption', label: '캡션', kind: 'text', optional: true },
      { key: 'primitive.parts', label: '전체 칸 수', kind: 'number', min: 1, max: 100 },
      { key: 'primitive.filled', label: '채운 칸 수', kind: 'number', min: 0, max: 100 },
    ],
  },
  {
    kind: 'math.fraction_strip', typeVersion: 1, label: '분수 막대 (옛 형식)', retired: true,
    hint: '이전 판본이 쓰던 형식이에요. 새로 만들 때는 「그림」 블록 안의 분수 막대를 씁니다.',
    create: () => ({ parts: 4, filled: 3, label: '' }),
    fields: [
      { key: 'parts', label: '전체 칸 수', kind: 'number', min: 1, max: 100 },
      { key: 'filled', label: '채운 칸 수', kind: 'number', min: 0, max: 100 },
      { key: 'label', label: '캡션', kind: 'text', optional: true },
      { key: 'labelAlt', label: '낭독용 이름', kind: 'text', optional: true, hint: '캡션에 수식을 쓸 때 필수예요.' },
    ],
  },
  {
    kind: 'core.scene', typeVersion: 1, label: '그림',
    hint: '도형을 마우스로 놓고 옮겨 그립니다. 그림 전체의 이름은 평문으로 따로 적어요.',
    create: () => ({ alt: '설명을 담은 그림', caption: '', width: 320, height: 200,
      items: [{ kind: 'rect', x: 100, y: 70, width: 120, height: 60, fill: 'fill-soft', stroke: 'fill', strokeWidth: 1, radius: 2 }] }),
    fields: [
      { key: 'alt', label: '그림 이름', kind: 'text', hint: altHint },
      { key: 'caption', label: '캡션', kind: 'text', optional: true },
    ],
    editsScene: true,
  },
  {
    kind: 'core.problem_set', typeVersion: 1, label: '문항 묶음', hint: '이 활동에서 풀 문항을 여기에서 쓰고 고칩니다. 한 문항은 한 활동에만 들어가요.',
    create: () => ({ problemVersionIds: [] }),
    fields: [], editsProblems: true,
  },
];
export const blockKey = (block: { kind: string; typeVersion: number }) => `${block.kind}@${block.typeVersion}`;
export const blockFormOf = (block: { kind: string; typeVersion: number }) =>
  blockForms.find((form) => form.kind === block.kind && form.typeVersion === block.typeVersion);

export const readPath = (payload: Record<string, unknown>, key: string): unknown =>
  key.split('.').reduce<unknown>((value, part) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined), payload);

export function writePath(payload: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = key.split('.');
  if (!rest.length) return { ...payload, [head]: value };
  const nested = payload[head];
  return { ...payload, [head]: writePath(nested && typeof nested === 'object' ? { ...(nested as Record<string, unknown>) } : {}, rest.join('.'), value) };
}

/**
 * An empty form field means "not set". Publishing validation rejects an empty optional string, so
 * both sides drop those before anything is checked; the server repeats it because it decides.
 */
export function pruneBlock(block: ContentBlock): ContentBlock {
  const form = blockFormOf(block);
  if (!form) return block;
  const empty = (value: unknown) => value === '' || value === undefined || value === null || (typeof value === 'number' && !Number.isFinite(value));
  const prune = (payload: Record<string, unknown>, fields: BlockField[]) => {
    let next = payload;
    for (const field of fields) {
      if (!field.optional || !empty(readPath(next, field.key))) continue;
      const [head, ...rest] = field.key.split('.');
      if (rest.length) next = writePath(next, field.key, undefined);
      else { next = { ...next }; delete next[head]; }
    }
    return next;
  };
  let payload = prune({ ...block.payload }, form.fields);
  if (form.list) {
    const rows = Array.isArray(payload[form.list.key]) ? (payload[form.list.key] as Record<string, unknown>[]) : [];
    payload = { ...payload, [form.list.key]: rows.map((row) => prune({ ...row }, form.list!.fields)) };
  }
  const pruned: ContentBlock = { ...block, payload };
  if (!pruned.fallback?.trim()) delete pruned.fallback;
  return pruned;
}

export function pruneSections(sections: ClassSection[]): ClassSection[] {
  return sections.map((section) => ({ ...section, contentBlocks: section.contentBlocks.map(pruneBlock) }));
}

export function pruneProblems(problems: DraftProblem[]): DraftProblem[] {
  return problems.map((problem) => ({ ...problem, promptContent: problem.promptContent.map(pruneBlock),
    hints: problem.hints.map(pruneBlock), solution: problem.solution.map(pruneBlock) }));
}

/** A question holds no activity of its own, and a drawing inside one is read rather than arranged. */
export const problemBlockForms = blockForms.filter((form) => form.kind !== 'core.problem_set');
