import 'server-only';
import { unfinishedIssues } from '@/shared/authoring-checks';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { canonicalJson, ContentError } from '@/core/content-bundle';
import { problemSetRefs, storedLessonOf, validateLesson, validateProblemSet, type StoredLesson, type StoredProblem, type StoredProblemSet } from '@/core/content';
import { gradeAnswer } from '@/core/grading';
import { frozenProblemSet, lessonRecord, importContent, problemSetRecords, publishedProblemRecords, definitionRecords, currentDefinitions } from './content-store';
import { AppError } from './errors';
import type { AnswerSpec } from '@/shared/answer';
import type { ContentBlock, LessonSection, ProblemSetRef } from '@/shared/api';
import {
  lessonKeyPattern, mayEditEveryDraft, mayGrantRoles, mayPublish, newProblem, nextBlockId, nextProblemVersionId,
  nextSectionId, problemSetIdPattern, pruneBlock, pruneProblems, pruneSections,
  renameProblem, renamedProblemVersionId, renameProblemReferences, responseSpecOf, scopeDefinitionLinks, suggestVersionId,
  type AccountRole, type AuthoringResponse, type AuthoringRole, type AuthoringWorkspace, type DraftDetail, type DraftIssue,
  type DraftEdit, type DraftProblem, type DraftSummary, type EditableConceptScope, type DefinitionChoice, type DefinitionEdit, type DefinitionSummary,
} from '@/shared/authoring';

const id = z.string().min(1).max(191);
const blockList = z.array(z.object({
  blockId: id,
  kind: z.string().min(1).max(100),
  typeVersion: z.number().int().min(1).max(999),
  required: z.boolean(),
  payload: z.record(z.string(), z.unknown()),
  fallback: z.string().max(2_000).optional(),
}).strict()).max(100);
const answerNumber = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
/** Structural only. A draft is saved while it is still wrong; publishing validation is the gate. */
const editSchema = z.object({
  meta: z.object({
    versionId: id.regex(/^[a-zA-Z0-9:._-]+$/),
    title: z.string().max(191),
    summary: z.string().max(500),
    estimatedMinutes: z.number().int().min(0).max(240),
    conceptKeys: z.array(id.max(100)).max(50),
    prerequisiteConceptKeys: z.array(id.max(100)).max(50).optional(),
  }).strict(),
  sections: z.array(z.object({
    sectionId: id,
    role: z.enum(['explanation', 'worked_example', 'practice', 'check', 'summary']),
    title: z.string().max(500),
    contentBlocks: blockList,
  }).strict()).min(1).max(50),
  reviewBlockId: id.nullable().optional(),
  // An answer says what a question expects; the response format and whether a hint exists follow
  // from it and from the hints, so the editor never sends either and the two cannot disagree.
  problems: z.array(z.object({
    problemVersionId: id,
    conceptKeys: z.array(id).max(50),
    promptContent: blockList,
    gradingSpec: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('integer'), value: answerNumber }).strict(),
      z.object({ kind: z.literal('rational'), numerator: answerNumber, denominator: answerNumber,
        requiredForm: z.literal('reduced_fraction').optional() }).strict(),
    ]),
    hints: blockList,
    solution: blockList,
  }).strict()).max(200),
}).strict();

export const authoringActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('course.save'), key: id.max(100).regex(/^[a-zA-Z0-9:._-]+$/), title: z.string().trim().min(1).max(191),
    summary: z.string().trim().max(500), creating: z.boolean() }).strict(),
  z.object({ action: z.literal('course.reorder'), courseKey: id.max(100), lessonKeys: z.array(id).max(1000) }).strict(),
  z.object({ action: z.literal('concept.create'), key: z.string().regex(lessonKeyPattern), label: z.string().trim().min(1).max(191) }).strict(),
  z.object({ action: z.literal('draft.create'), lessonKey: id }).strict(),
  z.object({ action: z.literal('lesson.read'), versionId: id }).strict(),
  z.object({ action: z.literal('lesson.create'), courseKey: id.max(100), lessonKey: z.string().regex(lessonKeyPattern),
    title: z.string().trim().min(1).max(191), conceptKeys: z.array(id.max(100)).max(50) }).strict(),
  z.object({ action: z.literal('draft.review'), draftId: id, asking: z.boolean() }).strict(),
  z.object({ action: z.literal('draft.save'), draftId: id, edit: editSchema }).strict(),
  z.object({ action: z.literal('draft.validate'), draftId: id }).strict(),
  z.object({ action: z.literal('draft.publish'), draftId: id }).strict(),
  z.object({ action: z.literal('draft.delete'), draftId: id }).strict(),
  z.object({ action: z.literal('account.search'), query: z.string().trim().min(2).max(80) }).strict(),
  z.object({ action: z.literal('role.grant'), userId: id, role: z.enum(['admin', 'author']) }).strict(),
  z.object({ action: z.literal('role.revoke'), userId: id }).strict(),
  z.object({ action: z.literal('definition.list'), scopeKind: z.enum(['global', 'lesson']), scopeKey: z.string().max(100) }).strict(),
  z.object({ action: z.literal('definition.save'), edit: z.object({
    conceptKey: id.max(100).regex(/^[a-zA-Z0-9:._-]+$/),
    scopeKind: z.enum(['global', 'lesson']),
    scopeKey: z.string().max(100),
    label: z.string().trim().max(191),
    summary: z.string().trim().max(500),
    blocks: blockList.max(20),
    newConcept: z.object({ label: z.string().trim().min(1).max(191) }).strict().optional(),
  }).strict() }).strict(),
  z.object({ action: z.literal('editor.expertMode'), on: z.boolean() }).strict(),
  z.object({ action: z.literal('draft.tryAnswer'), draftId: id, problemVersionId: id,
    answer: z.string().trim().min(1).max(100), assisted: z.boolean() }).strict(),
  z.object({ action: z.literal('draft.openHint'), draftId: id, problemVersionId: id }).strict(),
]);

/**
 * Opens the editor to anyone who reaches it, with no sign-in and no role. It exists for a service
 * that is deployed but not yet open to anyone, where the operator is the only visitor. It is not
 * access control: with this on, whoever finds the path can publish, delete drafts and read
 * unpublished work. Off unless the deployment says otherwise.
 */
export const openAuthoring = () => process.env.CONTENT_OPEN_ACCESS === 'true';
let announcedOpenAuthoring = false;
/** The author of record while no one signs in. Drafts still belong to an account, just a shared one. */
export async function openAuthoringAccount(db: PrismaClient) {
  if (!announcedOpenAuthoring) {
    announcedOpenAuthoring = true;
    console.warn(JSON.stringify({ event: 'content_authoring_open', detail: 'CONTENT_OPEN_ACCESS is on: the editor needs no sign-in.' }));
  }
  return db.user.upsert({ where: { id: 'open-authoring' }, update: {}, create: { id: 'open-authoring', displayName: '열린 편집' } });
}

/** The Google subjects a deployment names as its first administrators, before any row exists. */
const adminSubjects = () => (process.env.CONTENT_ADMIN_SUBJECTS || '').split(',').map((value) => value.trim()).filter(Boolean);

/**
 * Content work is a role an account holds, and where the role came from decides whether this
 * application can take it back. The environment names the first administrators so a new deployment
 * has someone who can grant the rest; every other grant is a row, which the role panel writes.
 */
export async function authoringRoleDetail(db: PrismaClient, userId: string): Promise<{ role: AuthoringRole | null; source: AccountRole['source'] }> {
  if (openAuthoring()) return { role: 'admin', source: 'environment' };
  const subjects = adminSubjects();
  if (subjects.length) {
    const identity = await db.googleIdentity.findUnique({ where: { userId } });
    if (identity && subjects.includes(identity.subject)) return { role: 'admin', source: 'environment' };
  }
  const grant = await db.contentAuthor.findUnique({ where: { userId } });
  return grant?.role === 'admin' || grant?.role === 'author'
    ? { role: grant.role, source: 'granted' }
    : { role: null, source: 'none' };
}

export async function authoringRole(db: PrismaClient, userId: string): Promise<AuthoringRole | null> {
  return (await authoringRoleDetail(db, userId)).role;
}

/** A stored question read back for editing; its response format is restated from the answer on save. */
const draftProblem = (problem: StoredProblem): DraftProblem => ({
  problemVersionId: problem.problemVersionId,
  conceptKeys: [...problem.conceptKeys],
  promptContent: structuredClone(problem.promptContent),
  // Checked when the base version was published, and again before this draft may be published.
  gradingSpec: structuredClone(problem.gradingSpec) as AnswerSpec,
  hints: structuredClone(problem.hints),
  solution: structuredClone(problem.solution),
});

/** What a problem set already is when a lesson draft is saved, so an activity can tell a change from a match. */
type SetContext = Map<string, { name: string | null; latest: StoredProblemSet | null; versions: number; draft: DraftRow | null }>;

/** The two fields an editor never writes: both follow from the answer and from the hints. */
const storedProblem = (problem: DraftProblem): StoredProblem => ({
  problemVersionId: problem.problemVersionId,
  conceptKeys: problem.conceptKeys,
  promptContent: problem.promptContent,
  responseSpec: responseSpecOf(problem.gradingSpec),
  hintAvailable: problem.hints.length > 0,
  gradingSpec: problem.gradingSpec,
  hints: problem.hints,
  solution: problem.solution,
});

/**
 * Every question a published version already holds, by name. An attempt, a hint use and an
 * assignment snapshot each record the name a question was answered under, so a published name may
 * never come to mean a different question. The index answers the two halves this needs: what the
 * questions this draft names were published as, and which names are already spoken for.
 */
type PublishedProblems = { record: Map<string, string>; taken: Set<string> };
async function publishedProblems(db: PrismaClient, named: string[]): Promise<PublishedProblems> {
  const [wanted, names] = await Promise.all([
    publishedProblemRecords(db, named),
    db.publishedProblem.findMany({ select: { problemVersionId: true }, distinct: ['problemVersionId'] }),
  ]);
  return {
    record: new Map([...wanted].map(([problemVersionId, problem]) => [problemVersionId, canonicalJson(problem)])),
    taken: new Set(names.map(row => row.problemVersionId)),
  };
}

/**
 * A draft may rewrite its own questions freely. A question a published version already holds is
 * another matter: editing one in place would change what a learner's answer meant, so it becomes a
 * new question named for the version being written, and the references in this document move with it.
 */
function renameEditedProblems(problems: StoredProblem[], versionId: string, published: PublishedProblems) {
  const taken = new Set(problems.map((problem) => problem.problemVersionId));
  const renames = new Map<string, string>();
  const next = problems.map((problem) => {
    const before = published.record.get(problem.problemVersionId);
    if (!before || before === canonicalJson(problem)) return problem;
    const renamed = renameProblem(problem, renamedProblemVersionId(problem.problemVersionId, versionId,
      (candidate) => taken.has(candidate) || published.taken.has(candidate)));
    taken.add(renamed.problemVersionId);
    renames.set(problem.problemVersionId, renamed.problemVersionId);
    return renamed;
  });
  return { problems: next, renames };
}

type DraftRow = { id: string; ownerKind: string; ownerKey: string; versionId: string; baseVersionId: string | null; title: string;
  document: unknown; status: string; authorId: string; publishedVersionId: string | null; updatedAt: Date;
  author: { displayName: string } };
const withAuthor = { author: { select: { displayName: true } } } as const;
/** What the editor sees of a lesson and its questions together, for placing a refusal beside its cause. */
type DraftView = { sections: LessonSection[]; problems: StoredProblem[] };
/** The problem set versions a lesson draft's activities reference, resolved to what they hold. */
type ResolvedSets = { published: Map<string, StoredProblemSet>; drafted: Map<string, { row: DraftRow; document: StoredProblemSet }> };

export class AuthoringService {
  constructor(private db: PrismaClient) {}

  private async require(userId: string): Promise<AuthoringRole> {
    const role = await authoringRole(this.db, userId);
    if (!role) throw new AppError(403, 'not_an_author', '콘텐츠를 편집할 권한이 없어요.');
    return role;
  }

  private summary(row: Omit<DraftRow, 'document' | 'ownerKind'>, userId: string): DraftSummary {
    return {
      id: row.id, lessonKey: row.ownerKey, versionId: row.versionId, baseVersionId: row.baseVersionId, title: row.title || '제목 없는 수업',
      status: row.status === 'published' ? 'published' : row.status === 'review' ? 'review' : 'draft',
      publishedVersionId: row.publishedVersionId,
      updatedAt: row.updatedAt.toISOString(), authorName: row.author.displayName, mine: row.authorId === userId,
    };
  }

  /**
   * The problem set versions a lesson draft references, each resolved to what it holds: a published
   * version reads from its rows, an unpublished one from the draft that will publish with the lesson.
   */
  private async resolveSets(document: StoredLesson): Promise<ResolvedSets> {
    const wanted = [...new Set(problemSetRefs(document).map((ref) => ref.problemSetVersionId))];
    const [published, rows] = await Promise.all([
      problemSetRecords(this.db, wanted),
      this.db.contentDraft.findMany({ where: { ownerKind: 'problem_set', versionId: { in: wanted }, status: { not: 'published' } }, include: withAuthor }),
    ]);
    const drafted = new Map((rows as DraftRow[]).map((row) => [row.versionId, { row, document: row.document as unknown as StoredProblemSet }]));
    return { published, drafted };
  }
  private setOf(sets: ResolvedSets, versionId: string): StoredProblemSet | undefined {
    return sets.drafted.get(versionId)?.document ?? sets.published.get(versionId);
  }
  /** The questions a lesson's activities hold, in the order the activities name them, each once. */
  private problemsOf(document: StoredLesson, sets: ResolvedSets): StoredProblem[] {
    const held = new Map<string, StoredProblem>();
    for (const ref of problemSetRefs(document)) {
      if (!ref.blockId) continue;
      const set = this.setOf(sets, ref.problemSetVersionId);
      for (const problemId of ref.problemVersionIds) {
        const problem = set?.problems.find((item) => item.problemVersionId === problemId);
        if (problem && !held.has(problemId)) held.set(problemId, problem);
      }
    }
    return [...held.values()];
  }

  /**
   * Writing a question means writing its answer, its hints and its solution, so an account that
   * holds a content role receives all of it. Nothing here is reachable without that role, and the
   * learning API still sends a learner only the public half.
   */
  private async detail(row: DraftRow, userId: string, issues: DraftIssue[], sets?: ResolvedSets): Promise<DraftDetail> {
    const document = row.document as unknown as StoredLesson;
    const resolved = sets ?? await this.resolveSets(document);
    const edit: DraftEdit = {
      meta: { versionId: document.public.versionId, title: document.public.title, summary: document.public.summary,
        estimatedMinutes: document.public.estimatedMinutes, conceptKeys: [...document.public.conceptKeys],
        prerequisiteConceptKeys: [...document.public.prerequisiteConceptKeys] },
      sections: structuredClone(document.sections),
      ...(document.review ? { reviewBlockId: document.sections.flatMap((section) => section.contentBlocks).find((block) =>
        block.kind === 'core.problem_set' && canonicalJson(block.payload) === canonicalJson(document.review))?.blockId } : { reviewBlockId: null }),
      problems: this.problemsOf(document, resolved).map(draftProblem),
    };
    const definitions = await this.definitionChoices(document.public.lessonKey);
    const glossary = (await currentDefinitions(this.db, definitions)).map((entry) => ({ ...entry, lessonKey: null }));
    return { ...this.summary(row, userId), edit, definitions, glossary, issues,
      review: document.review ? structuredClone(document.review) : null };
  }

  /**
   * The definitions this lesson may link while writing: the shared dictionary's and the lesson's own,
   * and only those with something to show — a row that merely renames a concept cannot be linked.
   */
  private async definitionChoices(lessonKey: string): Promise<DefinitionChoice[]> {
    const rows = await this.db.conceptDefinition.findMany({
      where: { OR: [{ scopeKind: 'global' }, { scopeKind: 'lesson', scopeKey: lessonKey }] },
      select: { id: true, conceptKey: true, scopeKind: true, scopeKey: true, label: true, concept: { select: { label: true } } },
    });
    const withBody = new Set((await this.db.contentBlock.findMany({
      where: { ownerKind: 'definition', ownerVersionId: { in: rows.map((row) => row.id) } },
      distinct: ['ownerVersionId'], select: { ownerVersionId: true } })).map((row) => row.ownerVersionId));
    return rows.filter((row) => withBody.has(row.id))
      .map((row) => ({ conceptKey: row.conceptKey, scopeKind: row.scopeKind === 'lesson' ? 'lesson' as const : 'global' as const,
        scopeKey: row.scopeKey, label: row.label ?? row.concept.label }))
      .sort((left, right) => left.label.localeCompare(right.label, 'ko'));
  }

  private async load(draftId: string, userId: string, role: AuthoringRole): Promise<DraftRow> {
    const row = await this.db.contentDraft.findUnique({ where: { id: draftId }, include: withAuthor });
    // The screen opens lesson drafts; a problem set draft is reached through the lesson that publishes it.
    if (!row || row.ownerKind !== 'lesson') throw new AppError(404, 'draft_missing', '초안을 찾을 수 없어요.');
    if (row.authorId !== userId && !mayEditEveryDraft(role)) throw new AppError(403, 'draft_not_yours', '다른 사람이 만든 초안이에요.');
    return row as DraftRow;
  }

  async workspace(userId: string): Promise<AuthoringWorkspace> {
    const role = await authoringRole(this.db, userId);
    if (!role) return { role: null, drafts: [], courses: [], lessons: [], accounts: [], concepts: [], expertMode: false };
    const [drafts, versions, courses, accounts, concepts, account, identities] = await Promise.all([
      this.db.contentDraft.findMany({ where: { ownerKind: 'lesson', ...(mayEditEveryDraft(role) ? {} : { authorId: userId }) },
        orderBy: { updatedAt: 'desc' }, select: { id: true, ownerKey: true, versionId: true, baseVersionId: true, title: true,
          status: true, authorId: true, publishedVersionId: true, updatedAt: true, document: true, ...withAuthor } }),
      this.db.lessonVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
        select: { id: true, lessonKey: true, title: true, metadata: true, lesson: { select: { course: { select: { key: true } } } } } }),
      this.db.course.findMany({ orderBy: [{ createdAt: 'asc' }, { key: 'asc' }], select: { key: true, title: true, summary: true } }),
      this.accounts(userId, role),
      this.db.concept.findMany({ orderBy: [{ assessable: 'desc' }, { label: 'asc' }], select: { key: true, label: true, assessable: true } }),
      this.db.user.findUnique({ where: { id: userId }, select: { editorExpertMode: true } }),
      this.db.lesson.findMany({ orderBy: [{ order: 'asc' }, { key: 'asc' }], select: { key: true, course: { select: { key: true } } } }),
    ]);
    const openDrafts = new Set(drafts.filter((draft) => draft.status !== 'published').map((draft) => draft.ownerKey));
    const byKey = new Map<string, { title: string; courseKey: string; versions: string[]; conceptKeys: string[] }>();
    for (const version of versions) {
      const entry = byKey.get(version.lessonKey) ?? { title: version.title, courseKey: version.lesson.course.key, versions: [], conceptKeys: [] };
      entry.title = version.title;
      entry.conceptKeys = (version.metadata as unknown as { public: { conceptKeys: string[] } }).public.conceptKeys;
      entry.versions.push(version.id);
      byKey.set(version.lessonKey, entry);
    }
    return {
      role,
      accounts,
      concepts,
      courses,
      expertMode: account?.editorExpertMode ?? false,
      drafts: drafts.map((row) => this.summary(row, userId)),
      lessons: identities.flatMap((identity) => {
        const entry = byKey.get(identity.key);
        const draft = drafts.find((item) => item.ownerKey === identity.key);
        // An unpublished lesson is visible only if this account can open its draft.
        if (!entry && !draft) return [];
        return [{ lessonKey: identity.key, courseKey: identity.course.key, title: entry?.title || draft?.title || '제목 없는 수업',
          conceptKeys: [...new Set([...(entry?.conceptKeys ?? []), ...drafts.filter(d => d.ownerKey === identity.key && d.status !== 'published')
            .flatMap(d => (d.document as unknown as StoredLesson).public.conceptKeys)])],
          latestVersionId: entry?.versions.at(-1) ?? null,
          suggestedVersionId: suggestVersionId(identity.key, entry?.versions ?? []), hasDraft: openDrafts.has(identity.key) }];
      }),
    };
  }

  /** Course identity and order change immediately, so only a publisher manages them. */
  async saveCourse(userId: string, key: string, title: string, summary: string, creating: boolean): Promise<AuthoringResponse> {
    if (!mayPublish(await this.require(userId))) throw new AppError(403, 'not_a_publisher', '코스 정보는 관리자만 고칠 수 있어요.');
    const existing = await this.db.course.findUnique({ where: { key } });
    if (creating && existing) throw new AppError(409, 'course_exists', '이미 쓰고 있는 코스 키예요.');
    if (!creating && !existing) throw new AppError(404, 'course_missing', '코스를 찾을 수 없어요.');
    if (creating) await this.db.course.create({ data: { key, title, summary } });
    else await this.db.course.update({ where: { key }, data: { title, summary } });
    return { workspace: await this.workspace(userId) };
  }

  async reorderCourse(userId: string, courseKey: string, lessonKeys: string[]): Promise<AuthoringResponse> {
    if (!mayPublish(await this.require(userId))) throw new AppError(403, 'not_a_publisher', '수업 순서는 관리자만 바꿀 수 있어요.');
    await this.db.$transaction(async (tx) => {
      const course = await tx.course.findUnique({ where: { key: courseKey }, include: { lessons: { select: { key: true } } } });
      if (!course) throw new AppError(404, 'course_missing', '코스를 찾을 수 없어요.');
      if (new Set(lessonKeys).size !== lessonKeys.length || course.lessons.length !== lessonKeys.length ||
        course.lessons.some((lesson) => !lessonKeys.includes(lesson.key))) {
        throw new AppError(409, 'course_changed', '수업 목록이 바뀌었어요. 화면을 새로 불러온 뒤 순서를 정해 주세요.');
      }
      for (const [order, key] of lessonKeys.entries()) await tx.lesson.update({ where: { key }, data: { order: order + 1 } });
    }, { isolationLevel: 'Serializable' });
    return { workspace: await this.workspace(userId) };
  }

  async createConcept(userId: string, key: string, label: string): Promise<AuthoringResponse> {
    if (!mayPublish(await this.require(userId))) throw new AppError(403, 'not_a_publisher', '학습 개념은 관리자만 추가할 수 있어요.');
    if (await this.db.concept.findUnique({ where: { key } })) throw new AppError(409, 'concept_exists', '이미 있는 개념이에요. 목록에서 골라 주세요.');
    await this.db.concept.create({ data: { key, label, assessable: true } });
    return { workspace: await this.workspace(userId) };
  }

  /**
   * The accounts that hold content work today. Environment-named administrators are listed beside
   * the granted ones so an administrator can see the whole picture, but they are not rows and this
   * screen says so rather than offering a button that could not work.
   */
  private async accounts(userId: string, role: AuthoringRole | null): Promise<AccountRole[]> {
    if (!mayGrantRoles(role)) return [];
    const subjects = adminSubjects();
    const [rows, named] = await Promise.all([
      this.db.contentAuthor.findMany({ orderBy: { grantedAt: 'asc' }, include: { user: { select: { displayName: true } } } }),
      subjects.length
        ? this.db.googleIdentity.findMany({ where: { subject: { in: subjects } }, include: { user: { select: { displayName: true } } } })
        : Promise.resolve([]),
    ]);
    const accounts = new Map<string, AccountRole>();
    for (const row of rows) {
      accounts.set(row.userId, { userId: row.userId, displayName: row.user.displayName,
        role: row.role === 'admin' ? 'admin' : 'author', source: 'granted',
        grantedAt: row.grantedAt.toISOString(), me: row.userId === userId });
    }
    // The environment wins the description: a row cannot take away what the environment grants.
    for (const identity of named) {
      accounts.set(identity.userId, { userId: identity.userId, displayName: identity.user.displayName,
        role: 'admin', source: 'environment', grantedAt: null, me: identity.userId === userId });
    }
    return [...accounts.values()];
  }

  private async requireGranter(userId: string): Promise<AuthoringRole> {
    const role = await this.require(userId);
    if (!mayGrantRoles(role)) throw new AppError(403, 'not_a_granter', '편집 권한은 관리자만 줄 수 있어요.');
    return role;
  }

  /** Names are what an administrator knows about a person, so that is what this looks up. */
  async searchAccounts(userId: string, query: string): Promise<AuthoringResponse> {
    await this.requireGranter(userId);
    const found = await this.db.user.findMany({
      where: { displayName: { contains: query }, id: { not: 'open-authoring' } },
      orderBy: { createdAt: 'asc' }, take: 20,
      select: { id: true, displayName: true, contentAuthor: { select: { role: true, grantedAt: true } } },
    });
    const subjects = adminSubjects();
    const named = subjects.length
      ? new Set((await this.db.googleIdentity.findMany({ where: { subject: { in: subjects }, userId: { in: found.map((user) => user.id) } },
          select: { userId: true } })).map((identity) => identity.userId))
      : new Set<string>();
    const matches: AccountRole[] = found.map((user) => (named.has(user.id)
      ? { userId: user.id, displayName: user.displayName, role: 'admin', source: 'environment', grantedAt: null, me: user.id === userId }
      : {
        userId: user.id, displayName: user.displayName,
        role: user.contentAuthor?.role === 'admin' ? 'admin' : user.contentAuthor?.role === 'author' ? 'author' : null,
        source: user.contentAuthor ? 'granted' : 'none',
        grantedAt: user.contentAuthor?.grantedAt.toISOString() ?? null, me: user.id === userId,
      }));
    return { workspace: await this.workspace(userId), matches };
  }

  /**
   * Two guards on anything that takes administrator away from an account, so that someone can still
   * publish tomorrow. An administrator never stands themselves down, which alone keeps the granted
   * list from emptying. The second is for an environment-named administrator, who could otherwise
   * remove the last granted one and leave a deployment whose only administrator disappears with its
   * environment. Lowering a role and taking it back are the same loss, so both pass through here.
   */
  private async assertAdminRemains(actorId: string, targetId: string): Promise<void> {
    if (targetId === actorId) throw new AppError(422, 'role_self', '자기 관리자 역할은 여기서 내려놓을 수 없어요.');
    if (await this.db.contentAuthor.count({ where: { role: 'admin' } }) <= 1) {
      throw new AppError(422, 'role_last_admin', '마지막 관리자예요. 다른 관리자를 먼저 세워 주세요.');
    }
  }

  async grantRole(userId: string, targetId: string, role: AuthoringRole): Promise<AuthoringResponse> {
    await this.requireGranter(userId);
    const target = await this.db.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw new AppError(404, 'account_missing', '그런 계정을 찾을 수 없어요.');
    // The shared account exists because no one was signed in; there is no person to hand work to.
    if (target.id === 'open-authoring') throw new AppError(422, 'account_shared', '공용 편집 계정에는 역할을 줄 수 없어요.');
    const current = await this.db.contentAuthor.findUnique({ where: { userId: targetId } });
    if (current?.role === 'admin' && role !== 'admin') await this.assertAdminRemains(userId, targetId);
    await this.db.contentAuthor.upsert({ where: { userId: targetId }, update: { role }, create: { userId: targetId, role } });
    return { workspace: await this.workspace(userId) };
  }

  /**
   * An environment-named role is not a row, so there is nothing here to remove — that one changes
   * with the deployment, and this says so rather than pretending to act.
   */
  async revokeRole(userId: string, targetId: string): Promise<AuthoringResponse> {
    await this.requireGranter(userId);
    const row = await this.db.contentAuthor.findUnique({ where: { userId: targetId } });
    if (!row) throw new AppError(404, 'role_missing', '이 계정에는 거둘 역할이 없어요.');
    if (row.role === 'admin') await this.assertAdminRemains(userId, targetId);
    else if (targetId === userId) throw new AppError(422, 'role_self', '자기 역할은 여기서 거둘 수 없어요.');
    await this.db.contentAuthor.delete({ where: { userId: targetId } });
    return { workspace: await this.workspace(userId) };
  }

  /**
   * The shared dictionary belongs to the operator, so only an administrator writes it. A definition
   * a lesson keeps is part of writing that lesson, which anyone holding a content role may do.
   */
  private async requireDefinitionScope(userId: string, scopeKind: EditableConceptScope, scopeKey: string): Promise<void> {
    const role = await this.require(userId);
    if (scopeKind === 'global') {
      if (!mayPublish(role)) throw new AppError(403, 'not_a_publisher', '공통 사전은 관리자만 고칠 수 있어요.');
      if (scopeKey) throw new AppError(422, 'scope_key', '공통 사전에는 소속을 적지 않아요.');
      return;
    }
    if (!scopeKey) throw new AppError(422, 'scope_key', '어느 수업의 뜻풀이인지 골라 주세요.');
    const owner = await this.db.lesson.findUnique({ where: { key: scopeKey }, select: { key: true } });
    if (!owner) throw new AppError(404, 'lesson_missing', '그런 수업이 없어요.');
  }

  /** Every definition one scope keeps: what an author opens and what they change. */
  async listDefinitions(userId: string, scopeKind: EditableConceptScope, scopeKey: string): Promise<AuthoringResponse> {
    await this.requireDefinitionScope(userId, scopeKind, scopeKey);
    const rows = await this.db.conceptDefinition.findMany({ where: { scopeKind, scopeKey }, include: { concept: { select: { label: true } } } });
    const records = await definitionRecords(this.db, rows);
    const definitions: DefinitionSummary[] = rows.map((row, index) => ({
      conceptKey: row.conceptKey, conceptLabel: row.concept.label, scopeKind, scopeKey,
      label: row.label ?? '', summary: row.summary ?? '', blocks: records[index].blocks as ContentBlock[],
      updatedAt: row.updatedAt.toISOString(),
    }));
    definitions.sort((left, right) => (left.label || left.conceptLabel).localeCompare(right.label || right.conceptLabel, 'ko'));
    return { workspace: await this.workspace(userId), definitions };
  }

  /**
   * A definition is written in place: saving is the latest, and every lesson that links it reads the
   * new wording at once. That is the bargain the glossary makes — a paragraph links a concept by key
   * rather than pinning a text, so a correction republishes nothing. Saving runs the CLI's own import,
   * so a definition that would break a reference is refused here for the same reason it would be
   * there. A concept nobody has named yet is made along the way and can also be selected in lessons and questions.
   */
  async saveDefinition(userId: string, edit: DefinitionEdit): Promise<AuthoringResponse> {
    await this.requireDefinitionScope(userId, edit.scopeKind, edit.scopeKey);
    const known = await this.db.concept.findUnique({ where: { key: edit.conceptKey }, select: { key: true } });
    if (!known && !edit.newConcept) throw new AppError(422, 'concept_missing', '없는 개념이에요. 새 개념이면 이름을 함께 적어 주세요.');
    // Blocks are named after the row that holds them, so the editor never chooses an ID.
    const stem = `${edit.scopeKind}:${edit.scopeKey || 'global'}:${edit.conceptKey}`;
    const blocks = edit.blocks.map(pruneBlock).map((block, index) => ({ ...block, blockId: `${stem}:b${index + 1}` }));
    const definition = { conceptKey: edit.conceptKey, scopeKind: edit.scopeKind, scopeKey: edit.scopeKey,
      ...(edit.label.trim() ? { label: edit.label.trim() } : {}), ...(edit.summary.trim() ? { summary: edit.summary.trim() } : {}), blocks };
    const concepts = !known && edit.newConcept ? [{ key: edit.conceptKey, label: edit.newConcept.label, assessable: true }] : [];
    try {
      await importContent(this.db, { schemaVersion: 1, concepts, lessons: [], diagnostics: [], definitions: [definition] });
    } catch (error) {
      throw new AppError(422, 'definition_rejected', describeContentError(error)[0]?.message ?? '뜻풀이를 저장하지 못했어요.');
    }
    return { ...await this.listDefinitions(userId, edit.scopeKind, edit.scopeKey), savedDefinition: { conceptKey: edit.conceptKey } };
  }

  /**
   * How much of itself the editor shows this account. It changes nothing about what the account may
   * do — the role decides that — so holding any content role is enough to set it.
   */
  async setExpertMode(userId: string, on: boolean): Promise<AuthoringResponse> {
    await this.require(userId);
    await this.db.user.update({ where: { id: userId }, data: { editorExpertMode: on } });
    return { workspace: await this.workspace(userId) };
  }

  /** The question as the draft holds it, for an author answering their own work. */
  private async draftProblem(userId: string, draftId: string, problemVersionId: string): Promise<StoredProblem> {
    const role = await this.require(userId);
    const row = await this.load(draftId, userId, role);
    const document = row.document as unknown as StoredLesson;
    const problem = this.problemsOf(document, await this.resolveSets(document)).find((item) => item.problemVersionId === problemVersionId);
    if (!problem) throw new AppError(404, 'problem_missing', '이 초안에 없는 문항이에요. 저장한 뒤 다시 해 보세요.');
    return problem;
  }

  /**
   * Judges an answer an author tried against their own draft. It is the learning API's grader, so
   * what the editor shows is what a learner will be told, down to the wording. Nothing is written:
   * the account trying this is writing the question, not learning from it, and an attempt recorded
   * here would become evidence about a person who never answered anything.
   */
  async tryAnswer(userId: string, draftId: string, problemVersionId: string, answer: string, assisted: boolean): Promise<AuthoringResponse> {
    const problem = await this.draftProblem(userId, draftId, problemVersionId);
    return { workspace: await this.workspace(userId), tried: gradeAnswer(answer, problem.gradingSpec, assisted) };
  }

  async draftHint(userId: string, draftId: string, problemVersionId: string): Promise<AuthoringResponse> {
    const problem = await this.draftProblem(userId, draftId, problemVersionId);
    return { workspace: await this.workspace(userId), hint: problem.hints };
  }

  /** Read a frozen version without creating an editable draft or changing publication state. */
  async readLesson(userId: string, versionId: string): Promise<AuthoringResponse> {
    await this.require(userId);
    const record = await lessonRecord(this.db, versionId);
    if (!record) throw new AppError(404, 'lesson_missing', '발행한 수업을 찾을 수 없어요.');
    const document = storedLessonOf(record);
    const versions = [...new Set(problemSetRefs(document).map(ref => ref.problemSetVersionId))];
    const sets: ResolvedSets = { published: await problemSetRecords(this.db, versions), drafted: new Map() };
    const row: DraftRow = { id: `published:${versionId}`, ownerKind: 'lesson', ownerKey: document.public.lessonKey,
      versionId, baseVersionId: versionId, title: document.public.title, document, status: 'published', authorId: '',
      publishedVersionId: versionId, updatedAt: new Date(0), author: { displayName: '발행판' } };
    return { workspace: await this.workspace(userId), draft: await this.detail(row, userId, [], sets) };
  }

  async createDraft(userId: string, lessonKey: string): Promise<AuthoringResponse> {
    await this.require(userId);
    const versions = await this.db.lessonVersion.findMany({ where: { lessonKey }, orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }], select: { id: true } });
    const base = versions[versions.length - 1];
    if (!base) throw new AppError(404, 'lesson_missing', '아직 발행된 적 없는 수업이에요. 새 수업 작성은 다음 단계예요.');
    const record = await lessonRecord(this.db, base.id);
    if (!record) throw new AppError(404, 'lesson_missing', '아직 발행된 적 없는 수업이에요. 새 수업 작성은 다음 단계예요.');
    // The draft starts by referencing the published problem set versions; editing one is what makes a set draft.
    const document = storedLessonOf(record);
    document.public.versionId = suggestVersionId(lessonKey, versions.map((version) => version.id));
    const row = await this.db.contentDraft.create({
      data: { ownerKind: 'lesson', ownerKey: lessonKey, versionId: document.public.versionId, baseVersionId: base.id, title: document.public.title,
        document: document as never, authorId: userId },
      include: withAuthor,
    });
    return this.opened(row as DraftRow, userId);
  }

  /** A draft as the screen receives it, with what is wrong in it found first. */
  private async opened(row: DraftRow, userId: string): Promise<AuthoringResponse> {
    const document = row.document as unknown as StoredLesson;
    const sets = await this.resolveSets(document);
    return { workspace: await this.workspace(userId), draft: await this.detail(row, userId, this.issues(document, sets), sets) };
  }

  /**
   * A lesson nobody has published yet. Everything else starts from a published version; this is the
   * one door into a key that has none, so it is also the only place the key itself is chosen — every
   * name inside the lesson is built from it, and once a version is published the key cannot move.
   */
  async createLesson(userId: string, courseKey: string, lessonKey: string, title: string, conceptKeys: string[]): Promise<AuthoringResponse> {
    await this.require(userId);
    const [course, taken, drafted, known] = await Promise.all([
      this.db.course.findUnique({ where: { key: courseKey }, select: { id: true } }),
      this.db.lesson.findUnique({ where: { key: lessonKey }, select: { key: true } }),
      this.db.contentDraft.findFirst({ where: { ownerKind: 'lesson', ownerKey: lessonKey }, select: { id: true } }),
      this.db.concept.findMany({ where: { key: { in: conceptKeys }, assessable: true }, select: { key: true } }),
    ]);
    if (!course) throw new AppError(404, 'course_missing', '그런 코스가 없어요. 코스를 먼저 골라 주세요.');
    if (taken || drafted) throw new AppError(409, 'lesson_exists', '이미 쓰이고 있는 수업 키예요. 다른 이름으로 지어 주세요.');
    const missing = conceptKeys.filter((key) => !known.some((concept) => concept.key === key));
    if (missing.length) throw new AppError(422, 'concept_missing', `없거나 평가할 수 없는 개념이에요: ${missing.join(', ')}`);
    // The lesson exists from here on — in its course, after the lessons already there — so a draft
    // never floats outside a course and the course's order already has a place for it.
    const last = await this.db.lesson.aggregate({ where: { courseId: course.id }, _max: { order: true } });
    await this.db.lesson.create({ data: { key: lessonKey, courseId: course.id, order: (last._max.order ?? 0) + 1 } });

    // A lesson in this product explains and then asks, and publishing refuses one that never asks.
    // So a new one starts as the smallest whole lesson rather than as something already invalid: one
    // step of explanation and one of practice, whose problem set is made here, in place, unnamed.
    const versionId = `${lessonKey}:v1`;
    const explaining = nextSectionId(lessonKey, 'explanation', versionId, []);
    const practising = nextSectionId(lessonKey, 'practice', versionId, [explaining]);
    const problem = storedProblem(newProblem(nextProblemVersionId(lessonKey, 'practice', versionId, []), conceptKeys.slice(0, 1)));
    const problemSetId = `${lessonKey}:practice`;
    await this.db.problemSet.create({ data: { id: problemSetId, courseId: course.id } });
    const set: StoredProblemSet = { problemSetId, courseKey, name: null, versionId: `${problemSetId}:v1`, problems: [problem] };
    const document: StoredLesson = {
      public: { lessonKey, versionId, title, summary: '한 줄 소개를 적어 주세요.', estimatedMinutes: 10,
        conceptKeys: [...conceptKeys], prerequisiteConceptKeys: [], sectionCount: 2 },
      sections: [
        { sectionId: explaining, role: 'explanation', title: '새 단계', contentBlocks: [
          { blockId: nextBlockId(lessonKey, explaining, 'core.rich_text', versionId, []), kind: 'core.rich_text',
            typeVersion: 3, required: true, payload: { text: '여기에 설명을 씁니다.', definitions: [] } },
        ] },
        { sectionId: practising, role: 'practice', title: '직접 풀어 보기', contentBlocks: [
          { blockId: nextBlockId(lessonKey, practising, 'core.problem_set', versionId, []), kind: 'core.problem_set',
            typeVersion: 2, required: true, payload: { problemSetId, problemSetVersionId: set.versionId, problemVersionIds: [problem.problemVersionId] } },
        ] },
      ],
      review: null,
    };
    await this.db.contentDraft.create({ data: { ownerKind: 'problem_set', ownerKey: problemSetId, versionId: set.versionId, baseVersionId: null,
      title, document: set as never, authorId: userId } });
    const row = await this.db.contentDraft.create({
      data: { ownerKind: 'lesson', ownerKey: lessonKey, versionId, baseVersionId: null, title, document: document as never, authorId: userId },
      include: withAuthor,
    });
    return this.opened(row as DraftRow, userId);
  }

  /**
   * A writer saying they are done, and asking whoever may publish to look. It locks nothing: being
   * asked to look at something is not a reason for its author to stop being able to fix it.
   */
  async setReview(userId: string, draftId: string, asking: boolean): Promise<AuthoringResponse> {
    const role = await this.require(userId);
    const row = await this.load(draftId, userId, role);
    if (row.status === 'published') throw new AppError(409, 'draft_published', '이미 발행한 초안이에요.');
    const saved = await this.db.contentDraft.update({ where: { id: draftId }, data: { status: asking ? 'review' : 'draft' }, include: withAuthor });
    return this.opened(saved as DraftRow, userId);
  }

  async saveDraft(userId: string, draftId: string, edit: DraftEdit): Promise<AuthoringResponse> {
    const role = await this.require(userId);
    const row = await this.load(draftId, userId, role);
    if (row.status === 'published') throw new AppError(409, 'draft_published', '이미 발행한 초안이에요. 새 초안을 만들어 주세요.');
    const stored = row.document as unknown as StoredLesson;
    const lesson = await this.db.lesson.findUnique({ where: { key: stored.public.lessonKey }, include: { course: { select: { id: true, key: true } } } });
    if (!lesson) throw new AppError(404, 'lesson_missing', '이 초안의 수업이 없어요.');
    const setIds = [...new Set(edit.sections.flatMap((section) => section.contentBlocks)
      .filter((block) => block.kind === 'core.problem_set').map((block) => String(block.payload.problemSetId ?? '')))];
    for (const setId of setIds) {
      if (!problemSetIdPattern.test(setId)) throw new AppError(422, 'problem_set_id', `문제집 이름이 올바르지 않아요: ${setId}`);
    }
    // What each set already is: its published latest, how many versions it has, and its open draft.
    const [rows, latestRows, counts, openDrafts] = await Promise.all([
      this.db.problemSet.findMany({ where: { id: { in: setIds } }, select: { id: true, name: true, courseId: true } }),
      Promise.all(setIds.map((problemSetId) => this.db.problemSetVersion.findFirst({ where: { problemSetId }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], select: { id: true } }))),
      Promise.all(setIds.map((problemSetId) => this.db.problemSetVersion.count({ where: { problemSetId } }))),
      this.db.contentDraft.findMany({ where: { ownerKind: 'problem_set', ownerKey: { in: setIds }, status: { not: 'published' } }, include: withAuthor }),
    ]);
    for (const known of rows) {
      if (known.courseId !== lesson.course.id) throw new AppError(422, 'problem_set_course', '다른 코스의 문제집은 이 수업에서 쓸 수 없어요.');
    }
    const latest = await problemSetRecords(this.db, latestRows.flatMap((version) => (version ? [version.id] : [])));
    const context: SetContext = new Map(setIds.map((problemSetId, index) => [problemSetId, {
      name: rows.find((known) => known.id === problemSetId)?.name ?? null,
      latest: latestRows[index] ? latest.get(latestRows[index]!.id) ?? null : null,
      versions: counts[index],
      draft: (openDrafts as DraftRow[]).find((open) => open.ownerKey === problemSetId) ?? null,
    }]));
    const { document, sets } = this.merge(stored, edit, await publishedProblems(this.db, edit.problems.map((problem) => problem.problemVersionId)),
      lesson.course.key, context);
    // A set the lesson names for the first time comes into being here, in its course, unnamed.
    for (const problemSetId of setIds) {
      if (!rows.some((known) => known.id === problemSetId)) await this.db.problemSet.create({ data: { id: problemSetId, courseId: lesson.course.id } });
    }
    // Set drafts follow the lesson: one open draft per set, gone when the lesson no longer needs it.
    const kept = new Set(sets.map((set) => set.versionId));
    for (const set of sets) {
      const open = context.get(set.problemSetId)?.draft;
      if (open) await this.db.contentDraft.update({ where: { id: open.id }, data: { versionId: set.versionId, document: set as never, title: edit.meta.title } });
      else await this.db.contentDraft.create({ data: { ownerKind: 'problem_set', ownerKey: set.problemSetId, versionId: set.versionId, baseVersionId: context.get(set.problemSetId)?.latest?.versionId ?? null,
        title: edit.meta.title, document: set as never, authorId: userId } });
    }
    const stale = (openDrafts as DraftRow[]).filter((open) => !kept.has(open.versionId) && !sets.some((set) => set.problemSetId === open.ownerKey));
    const previously = problemSetRefs(stored).filter((ref) => ref.blockId).map((ref) => ref.problemSetVersionId).filter((versionId) => !kept.has(versionId));
    await this.db.contentDraft.deleteMany({ where: { ownerKind: 'problem_set', status: { not: 'published' },
      OR: [{ id: { in: stale.map((open) => open.id) } }, { versionId: { in: previously } }] } });
    const saved = await this.db.contentDraft.update({ where: { id: draftId },
      data: { document: document as never, versionId: document.public.versionId, title: document.public.title }, include: withAuthor });
    return this.opened(saved as DraftRow, userId);
  }

  /**
   * Restates what the editor sent as a stored lesson and the problem sets its activities hold,
   * renaming the questions an edit changed. An activity whose questions match the set's latest
   * published version references that version and needs no draft; otherwise the set gets its next
   * version, drafted, to publish with the lesson.
   */
  private merge(stored: StoredLesson, edit: DraftEdit, published: PublishedProblems, courseKey: string, context: SetContext): { document: StoredLesson; sets: StoredProblemSet[] } {
    // A version belongs to its lesson. Without this, a draft could claim another lesson's version ID
    // and publish a record whose name says one lesson while its content teaches another.
    if (!edit.meta.versionId.startsWith(`${stored.public.lessonKey}:`)) {
      throw new AppError(422, 'version_scope', `판본 ID는 ${stored.public.lessonKey}: 로 시작해야 해요.`);
    }
    const lessonKey = stored.public.lessonKey;
    const scoped = (problem: DraftProblem): DraftProblem => ({ ...problem,
      promptContent: scopeDefinitionLinks(problem.promptContent, lessonKey),
      hints: scopeDefinitionLinks(problem.hints, lessonKey),
      solution: scopeDefinitionLinks(problem.solution, lessonKey) });
    const { problems, renames } = renameEditedProblems(pruneProblems(edit.problems).map(scoped).map(storedProblem), edit.meta.versionId, published);
    const byId = new Map(problems.map((problem) => [problem.problemVersionId, problem]));
    const sections = renameProblemReferences(pruneSections(edit.sections), renames)
      .map((section) => ({ ...section, contentBlocks: scopeDefinitionLinks(section.contentBlocks, lessonKey) }));
    // The questions each set holds: what its activities name, in order, each once.
    const holdings = new Map<string, StoredProblem[]>();
    for (const block of sections.flatMap((section) => section.contentBlocks)) {
      if (block.kind !== 'core.problem_set') continue;
      const problemSetId = String(block.payload.problemSetId ?? '');
      const held = holdings.get(problemSetId) ?? [];
      for (const problemId of (block.payload.problemVersionIds as string[] | undefined) ?? []) {
        const problem = byId.get(problemId);
        if (problem && !held.some((item) => item.problemVersionId === problemId)) held.push(problem);
      }
      holdings.set(problemSetId, held);
    }
    const sets: StoredProblemSet[] = [];
    const versionOf = new Map<string, string>();
    for (const [problemSetId, held] of holdings) {
      const state = context.get(problemSetId);
      const latest = state?.latest ?? null;
      if (latest && canonicalJson(latest.problems) === canonicalJson(held)) { versionOf.set(problemSetId, latest.versionId); continue; }
      const versionId = state?.draft?.versionId ?? `${problemSetId}:v${(state?.versions ?? 0) + 1}`;
      versionOf.set(problemSetId, versionId);
      sets.push({ problemSetId, courseKey, name: state?.name ?? null, versionId, problems: held });
    }
    const referenced = sections.map((section) => ({ ...section, contentBlocks: section.contentBlocks.map((block) => (block.kind === 'core.problem_set'
      ? { ...block, typeVersion: 2, payload: { problemSetId: String(block.payload.problemSetId ?? ''),
          problemSetVersionId: versionOf.get(String(block.payload.problemSetId ?? '')) ?? '',
          problemVersionIds: (block.payload.problemVersionIds as string[] | undefined) ?? [] } }
      : block)) }));
    let review = stored.review;
    if (edit.reviewBlockId === null) review = null;
    else if (edit.reviewBlockId !== undefined) {
      const block = referenced.flatMap((section) => section.contentBlocks).find((block) => block.blockId === edit.reviewBlockId && block.kind === 'core.problem_set');
      if (!block) throw new AppError(422, 'review_missing', '복습에 쓸 문제가 있는 단계를 다시 골라 주세요.');
      review = structuredClone(block.payload) as ProblemSetRef;
    }
    return { sets, document: {
      public: { ...stored.public, versionId: edit.meta.versionId, title: edit.meta.title, summary: edit.meta.summary,
        estimatedMinutes: edit.meta.estimatedMinutes, conceptKeys: [...edit.meta.conceptKeys],
        prerequisiteConceptKeys: [...(edit.meta.prerequisiteConceptKeys ?? stored.public.prerequisiteConceptKeys)], sectionCount: referenced.length },
      sections: referenced as StoredLesson['sections'],
      review,
    } };
  }

  /** What stops this draft from publishing: the lesson's own rules, and each set draft's. */
  private issues(document: StoredLesson, sets: ResolvedSets): DraftIssue[] {
    const found: DraftIssue[] = unfinishedIssues({ meta: document.public, sections: document.sections, problems: this.problemsOf(document, sets).map(draftProblem) });
    try { validateLesson(document); }
    catch (error) { found.push(...describeContentError(error, { sections: document.sections, problems: [] }).filter(issue => !found.some(existing => existing.field && existing.field === issue.field && existing.sectionId === issue.sectionId && !existing.blockId && !issue.blockId))); }
    for (const ref of problemSetRefs(document)) {
      if (!ref.blockId) continue;
      const set = this.setOf(sets, ref.problemSetVersionId);
      if (!set) { found.push({ message: `Missing problem set version: ${ref.problemSetVersionId} (${ref.blockId})`, blockId: ref.blockId }); continue; }
      for (const problemId of ref.problemVersionIds) {
        if (!set.problems.some((problem) => problem.problemVersionId === problemId)) found.push({ message: `Missing immutable problem version: ${problemId} (${ref.blockId})`, blockId: ref.blockId });
      }
    }
    for (const { document: set } of sets.drafted.values()) {
      try { validateProblemSet(set); }
      catch (error) { found.push(...describeContentError(error, { sections: [], problems: set.problems })); }
    }
    return found;
  }

  async validateDraft(userId: string, draftId: string): Promise<AuthoringResponse> {
    const role = await this.require(userId);
    const row = await this.load(draftId, userId, role);
    const document = row.document as unknown as StoredLesson;
    const sets = await this.resolveSets(document);
    const issues = this.issues(document, sets);
    // A lesson validates on its own but may still collide with published records, so the same dry run
    // the publish command uses decides here too.
    if (!issues.length) {
      try { await importContent(this.db, this.bundle(document, sets), true); }
      catch (error) { issues.push(...describeContentError(error, { sections: document.sections, problems: this.problemsOf(document, sets) })); }
    }
    return { workspace: await this.workspace(userId), draft: await this.detail(row, userId, issues, sets) };
  }

  /** The lesson and the set drafts it publishes with, as one bundle, so both land or neither does. */
  private bundle(document: StoredLesson, sets: ResolvedSets) {
    return { schemaVersion: 1 as const, concepts: [], lessons: [document], problemSets: [...sets.drafted.values()].map((entry) => entry.document),
      diagnostics: [], definitions: [] };
  }

  async publishDraft(userId: string, draftId: string): Promise<AuthoringResponse> {
    const role = await this.require(userId);
    if (!mayPublish(role)) throw new AppError(403, 'not_a_publisher', '발행은 관리자만 할 수 있어요. 검토를 요청해 주세요.');
    const row = await this.load(draftId, userId, role);
    const document = row.document as unknown as StoredLesson;
    const sets = await this.resolveSets(document);
    const issues = this.issues(document, sets);
    if (issues.length) throw new AppError(422, 'draft_invalid', '아직 고칠 곳이 있어 발행할 수 없어요.');
    try { await importContent(this.db, this.bundle(document, sets), false); }
    catch (error) {
      const described = describeContentError(error, { sections: document.sections, problems: this.problemsOf(document, sets) });
      throw new AppError(422, 'publish_rejected', described[0]?.message ?? '발행 검증을 통과하지 못했어요.');
    }
    // Re-publishing the same version is accepted as unchanged, so a failed update is safe to retry.
    for (const { row: setRow, document: set } of sets.drafted.values()) {
      await this.db.contentDraft.update({ where: { id: setRow.id }, data: { status: 'published', publishedVersionId: set.versionId } });
    }
    const published = await this.db.contentDraft.update({ where: { id: draftId },
      data: { status: 'published', publishedVersionId: document.public.versionId }, include: withAuthor });
    return { workspace: await this.workspace(userId), draft: await this.detail(published as DraftRow, userId, []), publishedVersionId: document.public.versionId };
  }

  async deleteDraft(userId: string, draftId: string): Promise<AuthoringResponse> {
    const role = await this.require(userId);
    const row = await this.load(draftId, userId, role);
    const document = row.document as unknown as StoredLesson;
    const sets = await this.resolveSets(document);
    // The set drafts this lesson was going to publish with go with it.
    await this.db.contentDraft.deleteMany({ where: { id: { in: [...sets.drafted.values()].map((entry) => entry.row.id) } } });
    await this.db.contentDraft.delete({ where: { id: row.id } });
    // A lesson that was only ever this draft leaves with it, so its key can be chosen again; so does
    // a problem set that was only ever a draft of it.
    const [versions, drafts] = await Promise.all([
      this.db.lessonVersion.count({ where: { lessonKey: row.ownerKey } }),
      this.db.contentDraft.count({ where: { ownerKind: 'lesson', ownerKey: row.ownerKey } }),
    ]);
    if (!versions && !drafts) await this.db.lesson.deleteMany({ where: { key: row.ownerKey } });
    for (const problemSetId of new Set(problemSetRefs(document).map((ref) => ref.problemSetId))) {
      const [setVersions, setDrafts] = await Promise.all([
        this.db.problemSetVersion.count({ where: { problemSetId } }),
        this.db.contentDraft.count({ where: { ownerKind: 'problem_set', ownerKey: problemSetId } }),
      ]);
      if (!setVersions && !setDrafts) await this.db.problemSet.deleteMany({ where: { id: problemSetId } });
    }
    return { workspace: await this.workspace(userId) };
  }

  async draft(userId: string, draftId: string): Promise<DraftDetail> {
    const role = await this.require(userId);
    const row = await this.load(draftId, userId, role);
    const document = row.document as unknown as StoredLesson;
    const sets = await this.resolveSets(document);
    return this.detail(row, userId, this.issues(document, sets), sets);
  }

  async act(userId: string, input: unknown): Promise<AuthoringResponse> {
    const action = authoringActionSchema.parse(input);
    switch (action.action) {
      case 'course.save': return this.saveCourse(userId, action.key, action.title, action.summary, action.creating);
      case 'course.reorder': return this.reorderCourse(userId, action.courseKey, action.lessonKeys);
      case 'concept.create': return this.createConcept(userId, action.key, action.label);
      case 'lesson.read': return this.readLesson(userId, action.versionId);
      case 'draft.create': return this.createDraft(userId, action.lessonKey);
      case 'lesson.create': return this.createLesson(userId, action.courseKey, action.lessonKey, action.title, action.conceptKeys);
      case 'draft.review': return this.setReview(userId, action.draftId, action.asking);
      case 'draft.save': return this.saveDraft(userId, action.draftId, action.edit);
      case 'draft.validate': return this.validateDraft(userId, action.draftId);
      case 'draft.publish': return this.publishDraft(userId, action.draftId);
      case 'draft.delete': return this.deleteDraft(userId, action.draftId);
      case 'account.search': return this.searchAccounts(userId, action.query);
      case 'role.grant': return this.grantRole(userId, action.userId, action.role);
      case 'role.revoke': return this.revokeRole(userId, action.userId);
      case 'definition.list': return this.listDefinitions(userId, action.scopeKind, action.scopeKey);
      case 'definition.save': return this.saveDefinition(userId, action.edit);
      case 'editor.expertMode': return this.setExpertMode(userId, action.on);
      case 'draft.tryAnswer': return this.tryAnswer(userId, action.draftId, action.problemVersionId, action.answer, action.assisted);
      case 'draft.openHint': return this.draftHint(userId, action.draftId, action.problemVersionId);
    }
  }
}

/**
 * Where in the document a validator's path points. The path is positional — `sections.2.contentBlocks.0`
 * — and positions move as a draft is written, so it is turned into the names the editor knows a
 * block by before it leaves the server.
 */
function locate(view: DraftView, path: readonly PropertyKey[]): Omit<DraftIssue, 'message' | 'path'> {
  const [root, index, ...rest] = path;
  const field = () => {
    const at = rest.indexOf('payload');
    return at >= 0 && at + 1 < rest.length ? rest.slice(at + 1).join('.') : undefined;
  };
  if (root === 'public' && typeof index === 'string') return { field: index };
  if (root === 'sections' && typeof index === 'number') {
    const section = view.sections[index];
    if (!section) return {};
    const block = rest[0] === 'contentBlocks' && typeof rest[1] === 'number' ? section.contentBlocks[rest[1]] : undefined;
    return { sectionId: section.sectionId, blockId: block?.blockId, field: block ? field() : rest[0] === 'title' ? 'title' : undefined };
  }
  if (root === 'problems' && typeof index === 'number') {
    const problem = view.problems[index];
    if (!problem) return {};
    const part = rest[0];
    const holds = part === 'promptContent' || part === 'hints' || part === 'solution';
    const block = holds && typeof rest[1] === 'number' ? problem[part][rest[1]] : undefined;
    return { problemVersionId: problem.problemVersionId, blockId: block?.blockId, field: block ? field() : undefined };
  }
  return {};
}

/**
 * A rule that refused something by name can be shown beside it. Reference rules name the block or
 * the question they refused, which is the only handle they give; a block's name is checked first
 * because it contains the question's, and the narrower answer is the useful one.
 */
function named(document: DraftView, message: string): Omit<DraftIssue, 'message' | 'path'> {
  for (const section of document.sections) {
    for (const block of section.contentBlocks) {
      if (message.includes(block.blockId)) return { sectionId: section.sectionId, blockId: block.blockId };
    }
  }
  for (const problem of document.problems) {
    for (const block of [...problem.promptContent, ...problem.hints, ...problem.solution]) {
      if (message.includes(block.blockId)) return { problemVersionId: problem.problemVersionId, blockId: block.blockId };
    }
    if (message.includes(problem.problemVersionId)) return { problemVersionId: problem.problemVersionId };
  }
  return {};
}

/**
 * Publishing rules speak in English for operators; the editor shows them next to the block they are
 * about. Only the rules are quoted: anything else that failed is reported as a failure, not as its
 * own text.
 */
export function describeContentError(error: unknown, document?: DraftView): DraftIssue[] {
  const where = (message: string, path?: readonly PropertyKey[]) => {
    if (!document) return {};
    const found = path ? locate(document, path) : {};
    return Object.values(found).some((value) => value !== undefined) ? found : named(document, message);
  };
  if (error instanceof z.ZodError) {
    return error.issues.slice(0, 20).map((issue) => ({
      message: issue.message, path: issue.path.join('.') || 'document', ...where(issue.message, issue.path),
    }));
  }
  if (error instanceof ContentError) return [{ message: error.message, ...where(error.message) }];
  if (error instanceof Error && error.name === 'Error') return [{ message: error.message, ...where(error.message) }];
  return [{ message: '검증하지 못했어요. 잠시 후 다시 시도해 주세요.' }];
}
