// Shared by the authoring API and the editor screen. Field descriptions live here so the editor can
// offer a form for every published block kind without importing the server's validation schemas,
// and so the server can prune the same optional fields before it validates what the editor sent.
import type { AnswerSpec } from './answer';
import type { LessonSection, ContentBlock, GradeResult, GlossaryEntry, ProblemSetRef, PublicProblem } from './api';

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
  id: string; lessonKey: string; versionId: string; baseVersionId: string | null; title: string;
  /**
   * Where the draft is. `review` is a writer saying they are done and asking the administrator who
   * may publish to look — it locks nothing, because being asked to look at something is not a
   * reason to stop being able to fix it.
   */
  status: 'draft' | 'review' | 'published'; publishedVersionId: string | null; updatedAt: string;
  authorName: string; mine: boolean;
};
export const draftStatusLabels: Record<DraftSummary['status'], string> = {
  draft: '작성 중', review: '검토 요청', published: '발행함',
};
/** `conceptKeys` are the concepts this lesson says it teaches; a question may only claim one of them. */
export type DraftMeta = { versionId: string; title: string; summary: string; estimatedMinutes: number; conceptKeys: string[]; prerequisiteConceptKeys?: string[] };
/** What each step of a lesson is for, in the words the learner's outline uses for it too. */
export const sectionRoleLabels: Record<LessonSection['role'], string> = {
  explanation: '설명', worked_example: '예시', practice: '연습', check: '확인', summary: '정리',
};
export const sectionRoles = Object.keys(sectionRoleLabels) as LessonSection['role'][];
/**
 * A question as the editor holds it. Answers, hints and solutions belong to the draft, so this
 * reaches a browser only where the account holds a content role. `responseSpec` and `hintAvailable`
 * follow from the answer and the hints, so an editor never states the same thing twice and the two
 * halves cannot drift apart.
 */
export type DraftProblem = {
  problemVersionId: string;
  conceptKeys: string[];
  promptContent: ContentBlock[];
  gradingSpec: AnswerSpec;
  hints: ContentBlock[];
  solution: ContentBlock[];
};
/** What an editor may change. Published questions are immutable, so the server renames what changed. */
export type DraftEdit = { meta: DraftMeta; sections: LessonSection[]; problems: DraftProblem[];
  /** Undefined preserves a separate review pool; null disables review; a block id selects its questions. */
  reviewBlockId?: string | null;
};
/** `definitions` are the definitions this lesson may link: the shared dictionary and its own. */
/**
 * Something that stops a draft from publishing, and where in the draft it is. The rules speak in
 * English because they are the same rules the import command enforces, but where they apply is the
 * editor's to say: an author should be taken to the block a rule refused, not handed its path.
 */
export type DraftIssue = {
  message: string;
  /** The validator's own path into the document, for whoever also operates the service. */
  path?: string;
  sectionId?: string;
  blockId?: string;
  problemVersionId?: string;
  /** The field inside a block's payload, so the editor can name it the way that block's form does. */
  field?: string;
};
/**
 * `review` describes the saved pool; `edit.reviewBlockId` chooses whether to retain or replace it.
 */
export type DraftDetail = DraftSummary & {
  edit: DraftEdit; definitions: DefinitionChoice[]; glossary: GlossaryEntry[]; issues: DraftIssue[]; review: ProblemSetRef | null;
};

/**
 * The shape of a draft: the steps it holds, the blocks in each, the questions the document keeps and
 * the order an activity names them in. Two edits that share a shape differ only in what someone
 * typed, which is what lets the editor fold a run of keystrokes into one undo step while still
 * breaking a step wherever something was added, removed, moved or renamed.
 */
export function editShape(edit: DraftEdit): string {
  const named = (blocks: ContentBlock[]) => blocks.map((block) => (block.kind === 'core.problem_set' && Array.isArray(block.payload.problemVersionIds)
    ? `${block.blockId}(${(block.payload.problemVersionIds as string[]).join(',')})`
    : block.blockId)).join(',');
  const sections = edit.sections.map((section) => `${section.sectionId}:${section.role}>${named(section.contentBlocks)}`).join('|');
  const problems = edit.problems.map((problem) =>
    `${problem.problemVersionId}>${named([...problem.promptContent, ...problem.hints, ...problem.solution])}`).join('|');
  return `${sections}#${problems}#${edit.reviewBlockId === undefined ? 'keep' : edit.reviewBlockId ?? 'none'}`;
}

export const responseSpecOf = (spec: AnswerSpec): PublicProblem['responseSpec'] =>
  (spec.kind === 'rational' && spec.requiredForm ? { kind: 'rational', requiredForm: spec.requiredForm } : { kind: spec.kind });
/** The half of a question a learner may see. The preview reads questions the way the lesson will. */
export const toPublicProblem = (problem: DraftProblem): PublicProblem => ({
  problemVersionId: problem.problemVersionId, conceptKeys: [...problem.conceptKeys],
  promptContent: problem.promptContent, responseSpec: responseSpecOf(problem.gradingSpec),
  hintAvailable: problem.hints.length > 0,
});
export type LessonChoice = { conceptKeys?: string[]; lessonKey: string; courseKey: string; title: string; latestVersionId: string | null; suggestedVersionId: string; hasDraft: boolean };
/** A course a new lesson may be started in. Every lesson has one from its first draft. */
export type CourseChoice = { key: string; title: string; summary: string };
/** The scopes this screen writes. The catalogue's other levels exist in the model, not yet here. */
export type EditableConceptScope = 'global' | 'lesson';
/**
 * A definition as the editor holds it: how one scope calls and explains a concept. Saving writes it
 * in place — a definition decides nothing, so it has no versions and no draft. An empty label means
 * the concept's own name. A concept nobody has named yet is made with the definition (`newConcept`),
 * available to lessons and questions as the same atomic concept.
 */
export type DefinitionEdit = {
  conceptKey: string; scopeKind: EditableConceptScope; scopeKey: string;
  label: string; summary: string; blocks: ContentBlock[];
  usageNote?: string;
  newConcept?: { label: string };
};
export type DefinitionSummary = Omit<DefinitionEdit, 'newConcept'> & { conceptLabel: string; updatedAt: string };
/** Enough of a definition to offer it while writing: what it is called and where it is kept. */
export type DefinitionChoice = { conceptKey: string; scopeKind: EditableConceptScope; scopeKey: string; label: string; usageNote?: string };
/** A concept as the pickers list it. Only an assessable one may be what a lesson teaches or a question asks. */
export type ConceptChoice = { key: string; label: string; assessable: boolean };
export type AuthoringWorkspace = {
  role: AuthoringRole | null; drafts: DraftSummary[]; courses: CourseChoice[]; lessons: LessonChoice[];
  accounts: AccountRole[]; concepts: ConceptChoice[];
  /**
   * Whether this account reads the editor as someone who also operates the service. It decides what
   * the screen shows, never what it may do: identifiers, the compatibility switches and the
   * validator's own words appear with it on, and what a lesson is made of is all that is left with
   * it off.
   */
  expertMode: boolean;
};
/** A key is what every name in a lesson is built from, so it stays to the letters a name may hold. */
export const lessonKeyPattern = /^[a-z0-9][a-z0-9-]{1,63}$/;
export type AuthoringAction =
  | { action: 'course.save'; key: string; title: string; summary: string; creating: boolean }
  | { action: 'course.reorder'; courseKey: string; lessonKeys: string[] }
  | { action: 'concept.create'; key: string; label: string }
  | { action: 'draft.create'; lessonKey: string }
  | { action: 'lesson.read'; versionId: string }
  /** A lesson nobody has published yet. It belongs to a course from this moment and starts as a draft. */
  | { action: 'lesson.create'; courseKey: string; lessonKey: string; title: string; conceptKeys: string[] }
  | { action: 'draft.review'; draftId: string; asking: boolean }
  | { action: 'draft.save'; draftId: string; edit: DraftEdit }
  | { action: 'draft.validate'; draftId: string }
  | { action: 'draft.publish'; draftId: string }
  | { action: 'draft.delete'; draftId: string }
  | { action: 'account.search'; query: string }
  | { action: 'role.grant'; userId: string; role: AuthoringRole }
  | { action: 'role.revoke'; userId: string }
  | { action: 'definition.list'; scopeKind: EditableConceptScope; scopeKey: string }
  | { action: 'definition.save'; edit: DefinitionEdit }
  | { action: 'editor.expertMode'; on: boolean }
  /**
   * Answering a question of the draft the way a learner would. Nothing is recorded: no attempt, no
   * progress, no evidence for what to recommend next. The answer is judged by the same grader the
   * learning API uses, which is why it is judged on the server rather than in the editor.
   */
  | { action: 'draft.tryAnswer'; draftId: string; problemVersionId: string; answer: string; assisted: boolean }
  | { action: 'draft.openHint'; draftId: string; problemVersionId: string };
export type AuthoringResponse = {
  workspace: AuthoringWorkspace; draft?: DraftDetail; publishedVersionId?: string;
  matches?: AccountRole[]; definitions?: DefinitionSummary[];
  /** What the grader said about an answer tried in the editor, and the hint a question carries. */
  tried?: GradeResult; hint?: ContentBlock[];
  /** The definition a save wrote, so the screen can say so. */
  savedDefinition?: { conceptKey: string };
};

const versionSuffix = /:v(\d+)$/;
/**
 * How a version reads to someone writing a lesson. `fraction-meaning:v4` is the name the records
 * use; what an author needs to know is that this is the fourth one. A name that does not end in a
 * number has nothing to shorten, so it is shown as it is rather than guessed at.
 */
export const versionLabel = (versionId: string) => {
  const match = versionSuffix.exec(versionId);
  return match ? `${match[1]}판` : versionId;
};

/**
 * The first words of a question, for a list that would otherwise name it by its identifier. A
 * formula is written between dollars and is drawn, not read, so a line with no room to draw one
 * says that a formula is there rather than showing its source.
 */
export function problemGist(problem: DraftProblem, limit = 42): string {
  const first = problem.promptContent.find((block) => typeof block.payload.text === 'string');
  const text = typeof first?.payload.text === 'string'
    ? first.payload.text.replace(/\$[^$]*\$/g, '[식]').replace(/\s+/g, ' ').trim()
    : '';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Generated names end in the version they were written for, the way published records read. */
const suffixOf = (versionId: string) => (versionSuffix.test(versionId) ? versionId.slice(versionId.lastIndexOf(':') + 1) : 'v1');
/** Published versions are immutable, so every edit becomes the next version of the same lesson. */
export function suggestVersionId(lessonKey: string, existing: string[]): string {
  const numbers = existing.map((id) => versionSuffix.exec(id)).filter((match) => match !== null).map((match) => Number(match[1]));
  return `${lessonKey}:v${Math.max(0, ...numbers) + 1}`;
}

/** Block IDs only need to be unique inside one document; the shape follows the published records. */
export function nextBlockId(lessonKey: string, sectionId: string, kind: string, versionId: string, taken: string[]): string {
  const role = sectionId.split(':')[1] ?? 'section';
  const name = kind.split('.')[1] ?? 'block';
  const suffix = suffixOf(versionId);
  for (let index = 1; ; index++) {
    const id = `${lessonKey}:${role}:${name}${index === 1 ? '' : `-${index}`}:${suffix}`;
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
export function nextSectionId(lessonKey: string, role: string, versionId: string, taken: string[]): string {
  const suffix = suffixOf(versionId);
  for (let index = 1; ; index++) {
    const id = `${lessonKey}:${role}${index === 1 ? '' : `-${index}`}:${suffix}`;
    if (!taken.includes(id)) return id;
  }
}

/**
 * Questions are named after the activity they belong to, the way the published records are. A
 * question keeps its name as it moves between versions, so a name already in use is in use whatever
 * version it ends in: a new question takes the next name rather than the same one in a new version.
 */
/** A definition starts as one paragraph, which is what most of them stay. */
export function newDefinition(scopeKind: EditableConceptScope, scopeKey: string): DefinitionEdit {
  return { conceptKey: '', scopeKind, scopeKey, label: '', summary: '',
    blocks: [{ blockId: 'definition:block:1', kind: 'core.rich_text', typeVersion: 3, required: true,
      payload: { text: '여기에 뜻을 풀어 씁니다.', definitions: [] } }] };
}

export function nextProblemVersionId(lessonKey: string, role: string, versionId: string, taken: string[]): string {
  const suffix = suffixOf(versionId);
  const names = new Set(taken.map((id) => (versionSuffix.test(id) ? id.slice(0, id.lastIndexOf(':')) : id)));
  for (let index = 1; ; index++) {
    const name = `${lessonKey}:${role}-${index}`;
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
export function renameProblemReferences(sections: LessonSection[], renames: Map<string, string>): LessonSection[] {
  if (!renames.size) return sections;
  return sections.map((section) => ({
    ...section,
    contentBlocks: section.contentBlocks.map((block) => (block.kind === 'core.problem_set' && Array.isArray(block.payload.problemVersionIds)
      ? { ...block, payload: { ...block.payload,
          problemVersionIds: (block.payload.problemVersionIds as string[]).map((id) => renames.get(id) ?? id) } }
      : block)),
  }));
}

/** Every question the activities in these blocks name, in the order they name them. */
export const problemIdsIn = (blocks: ContentBlock[]): string[] =>
  blocks.flatMap((block) => (block.kind === 'core.problem_set' && Array.isArray(block.payload.problemVersionIds)
    ? (block.payload.problemVersionIds as string[])
    : []));

/**
 * The questions nothing in the lesson holds any more. A question belongs to exactly one activity, so
 * taking an activity out of a lesson leaves its questions held by nothing, and publishing refuses a
 * lesson that carries one. Homework holds questions too, and those are held whether or not any
 * section shows them.
 */
export function looseProblems(edit: DraftEdit): DraftProblem[] {
  const held = new Set(problemIdsIn(edit.sections.flatMap((section) => section.contentBlocks)));
  return edit.problems.filter((problem) => !held.has(problem.problemVersionId));
}

/** The same edit with those questions gone: what an activity held leaves with the activity. */
export function dropLooseProblems(edit: DraftEdit): DraftEdit {
  const loose = looseProblems(edit);
  const reviewRemoved = !!edit.reviewBlockId && !edit.sections.some((section) => section.contentBlocks.some((block) => block.blockId === edit.reviewBlockId));
  if (!loose.length && !reviewRemoved) return edit;
  const gone = new Set(loose.map((problem) => problem.problemVersionId));
  return { ...edit, ...(reviewRemoved ? { reviewBlockId: null } : {}), problems: edit.problems.filter((problem) => !gone.has(problem.problemVersionId)) };
}

/**
 * A problem set made in place while writing: unnamed, in the lesson's course, owned by nothing but
 * the activity that made it until someone gives it a name. The server accepts the name the editor
 * chose as long as it has this shape.
 */
export const problemSetIdPattern = /^[a-z0-9][a-z0-9:._-]{1,190}$/;
export const newProblemSetId = () => `ps-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
// The version an unsaved activity names is a placeholder in the right shape; saving decides the real one.

/** The questions one activity holds, in the order that activity names them. */
export function problemsOfBlock(block: ContentBlock, problems: DraftProblem[]): DraftProblem[] {
  const ids = Array.isArray(block.payload.problemVersionIds) ? (block.payload.problemVersionIds as string[]) : [];
  return ids.map((id) => problems.find((problem) => problem.problemVersionId === id)).filter((problem) => problem !== undefined);
}

/** A question a learner has to answer, so a new one starts with a prompt and a numeric answer that the author replaces. */
export function newProblem(problemVersionId: string, conceptKeys: string[]): DraftProblem {
  return {
    problemVersionId, conceptKeys: [...conceptKeys],
    promptContent: [{ blockId: `${problemVersionId}:prompt`, kind: 'core.rich_text', typeVersion: 3, required: true,
      payload: { text: '여기에 문제를 씁니다.', definitions: [] } }],
    gradingSpec: { kind: 'integer', value: 0 },
    hints: [],
    solution: [],
  };
}

/**
 * A copy of a block placed beside the original. Everything the document names once takes a new name:
 * the block, and — when the block is an activity — every question it holds, because a question
 * belongs to exactly one activity and two activities may not name the same one.
 */
export function copyBlock(input: {
  block: ContentBlock; problems: DraftProblem[];
  lessonKey: string; sectionId: string; role: string; versionId: string;
  blockIds: string[]; problemIds: string[];
}): { block: ContentBlock; problems: DraftProblem[] } {
  const copied = structuredClone(input.block);
  copied.blockId = nextBlockId(input.lessonKey, input.sectionId, copied.kind, input.versionId, input.blockIds);
  if (copied.kind !== 'core.problem_set') return { block: copied, problems: [] };
  const held = problemsOfBlock(input.block, input.problems);
  const problemIds = [...input.problemIds];
  const problems = held.map((problem) => {
    const made = copyProblem(problem, input.lessonKey, input.role, input.versionId, problemIds);
    problemIds.push(made.problemVersionId);
    return made;
  });
  // A copied activity is a new set: two activities may not hold the same question, so they cannot share one.
  const problemSetId = newProblemSetId();
  copied.payload = { ...copied.payload, problemSetId, problemSetVersionId: `${problemSetId}:v1`,
    problemVersionIds: problems.map((problem) => problem.problemVersionId) };
  return { block: copied, problems };
}

/** A copy of a question, named after the activity it will sit in, with its own blocks renamed too. */
export function copyProblem(problem: DraftProblem, lessonKey: string, role: string, versionId: string, taken: string[]): DraftProblem {
  return renameProblem(structuredClone(problem), nextProblemVersionId(lessonKey, role, versionId, taken));
}

/**
 * A copy of a step placed beside the original: its own name, new names for every block in it, and
 * new questions for every activity it holds.
 */
export function copySection(input: {
  section: LessonSection; problems: DraftProblem[];
  lessonKey: string; versionId: string; sectionIds: string[]; blockIds: string[]; problemIds: string[];
}): { section: LessonSection; problems: DraftProblem[] } {
  const sectionId = nextSectionId(input.lessonKey, input.section.role, input.versionId, input.sectionIds);
  const blockIds = [...input.blockIds];
  const problemIds = [...input.problemIds];
  const problems: DraftProblem[] = [];
  const contentBlocks = input.section.contentBlocks.map((block) => {
    const made = copyBlock({ block, problems: input.problems, lessonKey: input.lessonKey, sectionId,
      role: input.section.role, versionId: input.versionId, blockIds, problemIds });
    blockIds.push(made.block.blockId);
    for (const problem of made.problems) problemIds.push(problem.problemVersionId);
    problems.push(...made.problems);
    return made.block;
  });
  return { section: { ...input.section, sectionId, title: `${input.section.title} 사본`, contentBlocks }, problems };
}

/** Puts a copy right after what it was copied from, which is where someone looks for it. */
export function insertAfter<T>(items: T[], index: number, made: T): T[] {
  return [...items.slice(0, index + 1), made, ...items.slice(index + 1)];
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
  key: string; label: string; kind: 'text' | 'multiline' | 'number' | 'boolean' | 'select';
  optional?: boolean; min?: number; max?: number; hint?: string;
  /** Required for `select`. An empty value means the field is unset and is pruned before publishing. */
  options?: { value: string; label: string }[];
};
export type BlockList = { key: string; label: string; addLabel: string; max: number; fields: BlockField[]; create: () => Record<string, unknown> };
export type BlockForm = {
  kind: string; typeVersion: number; label: string; hint: string;
  fields: BlockField[]; list?: BlockList; editsProblems?: boolean; editsScene?: boolean;
  /** Published lessons still hold these, so the editor can open one; nothing new is made with them. */
  retired?: boolean;
  create: () => Record<string, unknown>;
};

const altHint = '화면 낭독용 이름이에요. 수식 표기 없이 평문으로 씁니다.';
export const blockForms: BlockForm[] = [
  {
    kind: 'core.rich_text', typeVersion: 1, label: '글', hint: '$...$ 안에 수식을 넣을 수 있어요.',
    create: () => ({ text: '여기에 설명을 씁니다.' }),
    fields: [{ key: 'text', label: '글', kind: 'multiline' }],
  },
  {
    kind: 'core.rich_text', typeVersion: 3, label: '글',
    hint: '$...$ 안에 수식을 넣을 수 있어요. @를 치면 본문의 낱말에 개념의 뜻풀이를 걸 수 있습니다.',
    create: () => ({ text: '여기에 설명을 씁니다.', definitions: [] }),
    fields: [{ key: 'text', label: '글', kind: 'multiline' }],
    list: {
      key: 'definitions', label: '연결한 뜻풀이', addLabel: '뜻풀이 연결 추가', max: 20,
      create: () => ({ conceptKey: '', surface: '' }),
      fields: [
        { key: 'conceptKey', label: '개념 키', kind: 'text', hint: '뜻풀이가 있는 개념의 키' },
        { key: 'surface', label: '본문의 낱말', kind: 'text' },
        { key: 'scopeKind', label: '어디 뜻풀이', kind: 'select', optional: true,
          options: [{ value: '', label: '공통 사전' }, { value: 'lesson', label: '이 수업' }],
          hint: '공통 사전은 운영자가 쓴 뜻풀이예요. 이 수업의 뜻풀이는 같은 개념이라도 따로 있어요.' },
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
    hint: '수직선·좌표평면·도형을 넣고 옮겨 그릴 수 있어요. 글 속 수식은 $...$로 작성합니다.',
    create: () => ({ alt: '설명을 담은 그림', caption: '', width: 320, height: 200,
      items: [] }),
    fields: [
      { key: 'alt', label: '그림 이름', kind: 'text', hint: altHint },
      { key: 'caption', label: '캡션', kind: 'text', optional: true },
    ],
    editsScene: true,
  },
  {
    kind: 'core.problem_set', typeVersion: 2, label: '문제',
    hint: '학습자가 풀 문제를 추가하고 순서와 정답, 힌트를 고쳐요.',
    create: () => { const problemSetId = newProblemSetId(); return { problemSetId, problemSetVersionId: `${problemSetId}:v1`, problemVersionIds: [] }; },
    fields: [], editsProblems: true,
  },
];
/**
 * What a rule refused, named the way this screen names the field it was about. The rule keeps its
 * own words — they are the import command's words too, and rewriting them here would mean two
 * descriptions of one refusal — but `payload.text` is not a name anyone typed into, and 「글」 is.
 */
export function issueText(issue: DraftIssue, block?: ContentBlock): string {
  if (!block) return issue.message;
  // The rule names the kind of block it refused. The card it will be shown on already says that.
  const said = `Invalid payload for ${blockKey(block)}: `;
  const message = issue.message.startsWith(said) ? issue.message.slice(said.length) : issue.message;
  if (!issue.field) return message;
  const form = blockFormOf(block);
  const tail = issue.field.split('.').at(-1);
  const label = form?.fields.find((field) => field.key === issue.field)?.label
    ?? form?.list?.fields.find((field) => field.key === tail)?.label
    ?? form?.fields.find((field) => field.key === tail)?.label;
  return label ? `${label}: ${message}` : message;
}

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

export function pruneSections(sections: LessonSection[]): LessonSection[] {
  return sections.map((section) => ({ ...section, contentBlocks: section.contentBlocks.map(pruneBlock) }));
}

/**
 * Fills in which lesson keeps a definition. The editor only asks what kind of definition it is; which lesson owns
 * it follows from the document the block sits in, and writing it down here is what lets a
 * definition be resolved later without knowing who is reading.
 */
export function scopeDefinitionLinks(blocks: ContentBlock[], lessonKey: string): ContentBlock[] {
  return blocks.map((block) => {
    if (block.kind !== 'core.rich_text' || block.typeVersion !== 3 || !Array.isArray(block.payload.definitions)) return block;
    const definitions = (block.payload.definitions as Record<string, unknown>[]).map((definition) => {
      const next = { ...definition };
      if (next.scopeKind === 'lesson') next.scopeKey = lessonKey;
      else { delete next.scopeKind; delete next.scopeKey; }
      return next;
    });
    return { ...block, payload: { ...block.payload, definitions } };
  });
}

export function pruneProblems(problems: DraftProblem[]): DraftProblem[] {
  return problems.map((problem) => ({ ...problem, promptContent: problem.promptContent.map(pruneBlock),
    hints: problem.hints.map(pruneBlock), solution: problem.solution.map(pruneBlock) }));
}

/**
 * An author writes one kind of paragraph, not two. Both versions of it are called 글 and both open
 * for editing, because published lessons hold each; which one a palette offers follows from where
 * the block will sit, so nobody is asked to pick a schema version to get a definition link.
 */
const paragraph = (form: BlockForm, typeVersion: number) => form.kind === 'core.rich_text' && form.typeVersion === typeVersion;
/** A lesson's own blocks. Its paragraph is the one that can carry definition links. */
export const lessonBlockForms = blockForms.filter((form) => !paragraph(form, 1));
/** A question holds no activity of its own, and a drawing inside one is read rather than arranged. */
export const problemBlockForms = lessonBlockForms.filter((form) => form.kind !== 'core.problem_set');
/** Definitions explain and link other concepts; they never embed questions. */
export const definitionBlockForms = problemBlockForms;
