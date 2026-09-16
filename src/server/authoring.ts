import 'server-only';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { canonicalJson, ContentError } from '@/core/content-bundle';
import { validateClass, type StoredClass, type StoredProblem } from '@/core/content';
import { classRecord, importContent, publishedProblemRecords, termDefinitions } from './content-store';
import { AppError } from './errors';
import type { AnswerSpec } from '@/shared/answer';
import type { ContentBlock } from '@/shared/api';
import {
  mayEditEveryDraft, mayGrantRoles, mayPublish, nextTermVersionId, pruneBlock, pruneProblems, pruneSections,
  renameProblem, renamedProblemVersionId, renameProblemReferences, responseSpecOf, scopeTermAnnotations, suggestVersionId,
  type AccountRole, type AuthoringResponse, type AuthoringRole, type AuthoringWorkspace, type DraftDetail,
  type DraftEdit, type DraftProblem, type DraftSummary, type EditableTermScope, type TermChoice, type TermEdit, type TermSummary,
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
    title: z.string().trim().min(1).max(191),
    summary: z.string().trim().min(1).max(500),
    estimatedMinutes: z.number().int().min(1).max(240),
  }).strict(),
  sections: z.array(z.object({
    sectionId: id,
    role: z.enum(['explanation', 'worked_example', 'practice', 'check', 'summary']),
    title: z.string().min(1).max(500),
    contentBlocks: blockList,
  }).strict()).min(1).max(50),
  // An answer says what a question expects; the response format and whether a hint exists follow
  // from it and from the hints, so the editor never sends either and the two cannot disagree.
  problems: z.array(z.object({
    problemVersionId: id,
    skillKeys: z.array(id).max(50),
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
  z.object({ action: z.literal('draft.create'), classKey: id }).strict(),
  z.object({ action: z.literal('draft.save'), draftId: id, edit: editSchema }).strict(),
  z.object({ action: z.literal('draft.validate'), draftId: id }).strict(),
  z.object({ action: z.literal('draft.publish'), draftId: id }).strict(),
  z.object({ action: z.literal('draft.delete'), draftId: id }).strict(),
  z.object({ action: z.literal('account.search'), query: z.string().trim().min(2).max(80) }).strict(),
  z.object({ action: z.literal('role.grant'), userId: id, role: z.enum(['admin', 'author']) }).strict(),
  z.object({ action: z.literal('role.revoke'), userId: id }).strict(),
  z.object({ action: z.literal('term.list'), scopeKind: z.enum(['global', 'class']), scopeKey: z.string().max(100) }).strict(),
  z.object({ action: z.literal('term.save'), edit: z.object({
    termKey: id.max(100).regex(/^[a-zA-Z0-9:._-]+$/),
    scopeKind: z.enum(['global', 'class']),
    scopeKey: z.string().max(100),
    skillKey: id.max(100),
    label: z.string().trim().min(1).max(191),
    summary: z.string().trim().min(1).max(500),
    blocks: blockList.min(1).max(20),
  }).strict() }).strict(),
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
  skillKeys: [...problem.skillKeys],
  promptContent: structuredClone(problem.promptContent),
  // Checked when the base version was published, and again before this draft may be published.
  gradingSpec: structuredClone(problem.gradingSpec) as AnswerSpec,
  hints: structuredClone(problem.hints),
  solution: structuredClone(problem.solution),
});

/** The two fields an editor never writes: both follow from the answer and from the hints. */
const storedProblem = (problem: DraftProblem): StoredProblem => ({
  problemVersionId: problem.problemVersionId,
  skillKeys: problem.skillKeys,
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

type DraftRow = { id: string; classKey: string; versionId: string; baseVersionId: string | null; title: string;
  document: unknown; status: string; authorId: string; publishedVersionId: string | null; updatedAt: Date;
  author: { displayName: string } };

export class AuthoringService {
  constructor(private db: PrismaClient) {}

  private async require(userId: string): Promise<AuthoringRole> {
    const role = await authoringRole(this.db, userId);
    if (!role) throw new AppError(403, 'not_an_author', '콘텐츠를 편집할 권한이 없어요.');
    return role;
  }

  private summary(row: DraftRow, userId: string): DraftSummary {
    return {
      id: row.id, classKey: row.classKey, versionId: row.versionId, baseVersionId: row.baseVersionId, title: row.title,
      status: row.status === 'published' ? 'published' : 'draft', publishedVersionId: row.publishedVersionId,
      updatedAt: row.updatedAt.toISOString(), authorName: row.author.displayName, mine: row.authorId === userId,
    };
  }

  /**
   * Writing a question means writing its answer, its hints and its solution, so an account that
   * holds a content role receives all of it. Nothing here is reachable without that role, and the
   * learning API still sends a learner only the public half.
   */
  private async detail(row: DraftRow, userId: string, issues: string[]): Promise<DraftDetail> {
    const document = row.document as unknown as StoredClass;
    const edit: DraftEdit = {
      meta: { versionId: document.public.versionId, title: document.public.title, summary: document.public.summary, estimatedMinutes: document.public.estimatedMinutes },
      sections: structuredClone(document.sections),
      problems: document.problems.map(draftProblem),
    };
    return { ...this.summary(row, userId), edit, skillKeys: [...document.public.skillKeys],
      terms: await this.termChoices(document.public.classKey), issues };
  }

  /**
   * The definitions this class may link while writing: the shared dictionary and the ones the class
   * keeps. Only what naming a term needs — a definition's own text is read from the term screen.
   */
  private async termChoices(classKey: string): Promise<TermChoice[]> {
    const rows = await this.db.termVersion.findMany({
      where: { OR: [{ scopeKind: 'global' }, { scopeKind: 'class', scopeKey: classKey }] },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: { termKey: true, scopeKind: true, scopeKey: true, label: true, skillKey: true },
    });
    const seen = new Set<string>();
    const choices: TermChoice[] = [];
    for (const row of rows) {
      const scopeKind = row.scopeKind === 'class' ? 'class' as const : 'global' as const;
      const ref = `${scopeKind}:${row.scopeKey}:${row.termKey}`;
      if (seen.has(ref)) continue;
      seen.add(ref);
      choices.push({ termKey: row.termKey, scopeKind, scopeKey: row.scopeKey, label: row.label, skillKey: row.skillKey });
    }
    return choices.sort((left, right) => left.label.localeCompare(right.label, 'ko'));
  }

  private async load(draftId: string, userId: string, role: AuthoringRole): Promise<DraftRow> {
    const row = await this.db.contentDraft.findUnique({ where: { id: draftId }, include: { author: { select: { displayName: true } } } });
    if (!row) throw new AppError(404, 'draft_missing', '초안을 찾을 수 없어요.');
    if (row.authorId !== userId && !mayEditEveryDraft(role)) throw new AppError(403, 'draft_not_yours', '다른 사람이 만든 초안이에요.');
    return row as DraftRow;
  }

  async workspace(userId: string): Promise<AuthoringWorkspace> {
    const role = await authoringRole(this.db, userId);
    if (!role) return { role: null, drafts: [], classes: [], accounts: [], skills: [] };
    const [drafts, versions, accounts, skills] = await Promise.all([
      this.db.contentDraft.findMany({ where: mayEditEveryDraft(role) ? {} : { authorId: userId },
        orderBy: { updatedAt: 'desc' }, take: 50, include: { author: { select: { displayName: true } } } }),
      this.db.classVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }], select: { id: true, classKey: true, title: true } }),
      this.accounts(userId, role),
      this.db.skill.findMany({ orderBy: [{ order: 'asc' }, { key: 'asc' }], select: { key: true, label: true } }),
    ]);
    const openDrafts = new Set(drafts.filter((draft) => draft.status !== 'published').map((draft) => draft.classKey));
    const byKey = new Map<string, { title: string; versions: string[] }>();
    for (const version of versions) {
      const entry = byKey.get(version.classKey) ?? { title: version.title, versions: [] };
      entry.title = version.title;
      entry.versions.push(version.id);
      byKey.set(version.classKey, entry);
    }
    return {
      role,
      accounts,
      skills,
      drafts: (drafts as DraftRow[]).map((row) => this.summary(row, userId)),
      classes: [...byKey.entries()].map(([classKey, entry]) => ({
        classKey, title: entry.title, latestVersionId: entry.versions[entry.versions.length - 1],
        suggestedVersionId: suggestVersionId(classKey, entry.versions), hasDraft: openDrafts.has(classKey),
      })),
    };
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
   * a class keeps is part of writing that class, which anyone holding a content role may do.
   */
  private async requireTermScope(userId: string, scopeKind: EditableTermScope, scopeKey: string): Promise<void> {
    const role = await this.require(userId);
    if (scopeKind === 'global') {
      if (!mayPublish(role)) throw new AppError(403, 'not_a_publisher', '공통 사전은 관리자만 고칠 수 있어요.');
      if (scopeKey) throw new AppError(422, 'scope_key', '공통 사전에는 소속을 적지 않아요.');
      return;
    }
    if (!scopeKey) throw new AppError(422, 'scope_key', '어느 클래스의 용어인지 골라 주세요.');
    const owner = await this.db.classVersion.findFirst({ where: { classKey: scopeKey }, select: { id: true } });
    if (!owner) throw new AppError(404, 'class_missing', '아직 발행된 적 없는 클래스예요.');
  }

  /** The latest version of each term in one scope: what an author opens and what they change. */
  async listTerms(userId: string, scopeKind: EditableTermScope, scopeKey: string): Promise<AuthoringResponse> {
    await this.requireTermScope(userId, scopeKind, scopeKey);
    const rows = await this.db.termVersion.findMany({ where: { scopeKind, scopeKey }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }] });
    const seen = new Set<string>();
    const latest = rows.filter((row) => { if (seen.has(row.termKey)) return false; seen.add(row.termKey); return true; });
    const definitions = await termDefinitions(this.db, latest);
    const terms: TermSummary[] = latest.map((row, index) => ({
      versionId: row.id, termKey: row.termKey, scopeKind, scopeKey, skillKey: row.skillKey,
      label: row.label, summary: row.summary, blocks: definitions[index].blocks as ContentBlock[],
      publishedAt: row.publishedAt.toISOString(),
    }));
    terms.sort((left, right) => left.label.localeCompare(right.label, 'ko'));
    return { workspace: await this.workspace(userId), terms };
  }

  /**
   * A definition is published, not drafted: saving writes the next version and every reader sees it
   * at once. That is the same bargain the rest of the glossary already makes — a definition is
   * carried by key rather than pinned, so a correction reaches the classes that link it without
   * republishing any of them. Publishing runs the CLI's own import, so a definition that would
   * break a reference is refused here for the same reason it would be refused there.
   */
  async saveTerm(userId: string, edit: TermEdit): Promise<AuthoringResponse> {
    await this.requireTermScope(userId, edit.scopeKind, edit.scopeKey);
    const existing = await this.db.termVersion.findMany({
      where: { scopeKind: edit.scopeKind, scopeKey: edit.scopeKey, termKey: edit.termKey }, select: { id: true } });
    const versionId = nextTermVersionId(edit, existing.map((row) => row.id));
    // Blocks are named after the version that holds them, so the editor never chooses an ID.
    const blocks = edit.blocks.map(pruneBlock).map((block, index) => ({ ...block, blockId: `${versionId}:b${index + 1}` }));
    const definition = { versionId, termKey: edit.termKey, scopeKind: edit.scopeKind, scopeKey: edit.scopeKey,
      skillKey: edit.skillKey, label: edit.label, summary: edit.summary, blocks };
    try {
      await importContent(this.db, { schemaVersion: 1, skills: [], classes: [], diagnostics: [], terms: [definition] });
    } catch (error) {
      throw new AppError(422, 'term_rejected', describeContentError(error)[0] ?? '용어를 발행하지 못했어요.');
    }
    return { ...await this.listTerms(userId, edit.scopeKind, edit.scopeKey), publishedTermVersionId: versionId };
  }

  async createDraft(userId: string, classKey: string): Promise<AuthoringResponse> {
    await this.require(userId);
    const versions = await this.db.classVersion.findMany({ where: { classKey }, orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }], select: { id: true } });
    const base = versions[versions.length - 1];
    if (!base) throw new AppError(404, 'class_missing', '아직 발행된 적 없는 클래스예요. 새 클래스 작성은 다음 단계예요.');
    const document = await classRecord(this.db, base.id);
    if (!document) throw new AppError(404, 'class_missing', '아직 발행된 적 없는 클래스예요. 새 클래스 작성은 다음 단계예요.');
    document.public.versionId = suggestVersionId(classKey, versions.map((version) => version.id));
    const row = await this.db.contentDraft.create({
      data: { classKey, versionId: document.public.versionId, baseVersionId: base.id, title: document.public.title,
        document: document as never, authorId: userId },
      include: { author: { select: { displayName: true } } },
    });
    return { workspace: await this.workspace(userId), draft: await this.detail(row as DraftRow, userId, this.issues(document)) };
  }

  async saveDraft(userId: string, draftId: string, edit: DraftEdit): Promise<AuthoringResponse> {
    const role = await this.require(userId);
    const row = await this.load(draftId, userId, role);
    if (row.status === 'published') throw new AppError(409, 'draft_published', '이미 발행한 초안이에요. 새 초안을 만들어 주세요.');
    const document = this.merge(row.document as unknown as StoredClass, edit,
      await publishedProblems(this.db, edit.problems.map((problem) => problem.problemVersionId)));
    const saved = await this.db.contentDraft.update({ where: { id: draftId },
      data: { document: document as never, versionId: document.public.versionId, title: document.public.title },
      include: { author: { select: { displayName: true } } } });
    return { workspace: await this.workspace(userId), draft: await this.detail(saved as DraftRow, userId, this.issues(document)) };
  }

  /** Restates what the editor sent as a stored document, renaming the questions an edit changed. */
  private merge(stored: StoredClass, edit: DraftEdit, published: PublishedProblems): StoredClass {
    // A version belongs to its class. Without this, a draft could claim another class's version ID
    // and publish a record whose name says one class while its content teaches another.
    if (!edit.meta.versionId.startsWith(`${stored.public.classKey}:`)) {
      throw new AppError(422, 'version_scope', `판본 ID는 ${stored.public.classKey}: 로 시작해야 해요.`);
    }
    const classKey = stored.public.classKey;
    const scoped = (problem: DraftProblem): DraftProblem => ({ ...problem,
      promptContent: scopeTermAnnotations(problem.promptContent, classKey),
      hints: scopeTermAnnotations(problem.hints, classKey),
      solution: scopeTermAnnotations(problem.solution, classKey) });
    const { problems, renames } = renameEditedProblems(pruneProblems(edit.problems).map(scoped).map(storedProblem), edit.meta.versionId, published);
    const sections = renameProblemReferences(pruneSections(edit.sections), renames)
      .map((section) => ({ ...section, contentBlocks: scopeTermAnnotations(section.contentBlocks, classKey) }));
    return {
      ...stored,
      public: { ...stored.public, versionId: edit.meta.versionId, title: edit.meta.title, summary: edit.meta.summary,
        estimatedMinutes: edit.meta.estimatedMinutes, sectionCount: sections.length },
      sections: sections as StoredClass['sections'],
      problems,
      // Homework names questions without a block of its own, so its references move the same way.
      homeworkProblemIds: stored.homeworkProblemIds.map((problemId) => renames.get(problemId) ?? problemId),
    };
  }

  private issues(document: StoredClass): string[] {
    try { validateClass(document); return []; }
    catch (error) { return describeContentError(error); }
  }

  async validateDraft(userId: string, draftId: string): Promise<AuthoringResponse> {
    const role = await this.require(userId);
    const row = await this.load(draftId, userId, role);
    const document = row.document as unknown as StoredClass;
    const issues = this.issues(document);
    // A class validates on its own but may still collide with published records, so the same dry run
    // the publish command uses decides here too.
    if (!issues.length) {
      try { await importContent(this.db, this.bundle(document), true); }
      catch (error) { issues.push(...describeContentError(error)); }
    }
    return { workspace: await this.workspace(userId), draft: await this.detail(row, userId, issues) };
  }

  private bundle(document: StoredClass) {
    return { schemaVersion: 1 as const, skills: [], classes: [document], diagnostics: [], terms: [] };
  }

  async publishDraft(userId: string, draftId: string): Promise<AuthoringResponse> {
    const role = await this.require(userId);
    if (!mayPublish(role)) throw new AppError(403, 'not_a_publisher', '발행은 관리자만 할 수 있어요. 검토를 요청해 주세요.');
    const row = await this.load(draftId, userId, role);
    const document = row.document as unknown as StoredClass;
    const issues = this.issues(document);
    if (issues.length) throw new AppError(422, 'draft_invalid', '아직 고칠 곳이 있어 발행할 수 없어요.');
    try { await importContent(this.db, this.bundle(document), false); }
    catch (error) {
      const described = describeContentError(error);
      throw new AppError(422, 'publish_rejected', described[0] ?? '발행 검증을 통과하지 못했어요.');
    }
    // Re-publishing the same version is accepted as unchanged, so a failed update is safe to retry.
    const published = await this.db.contentDraft.update({ where: { id: draftId },
      data: { status: 'published', publishedVersionId: document.public.versionId },
      include: { author: { select: { displayName: true } } } });
    return { workspace: await this.workspace(userId), draft: await this.detail(published as DraftRow, userId, []), publishedVersionId: document.public.versionId };
  }

  async deleteDraft(userId: string, draftId: string): Promise<AuthoringResponse> {
    const role = await this.require(userId);
    const row = await this.load(draftId, userId, role);
    await this.db.contentDraft.delete({ where: { id: row.id } });
    return { workspace: await this.workspace(userId) };
  }

  async draft(userId: string, draftId: string): Promise<DraftDetail> {
    const role = await this.require(userId);
    const row = await this.load(draftId, userId, role);
    return this.detail(row, userId, this.issues(row.document as unknown as StoredClass));
  }

  async act(userId: string, input: unknown): Promise<AuthoringResponse> {
    const action = authoringActionSchema.parse(input);
    switch (action.action) {
      case 'draft.create': return this.createDraft(userId, action.classKey);
      case 'draft.save': return this.saveDraft(userId, action.draftId, action.edit);
      case 'draft.validate': return this.validateDraft(userId, action.draftId);
      case 'draft.publish': return this.publishDraft(userId, action.draftId);
      case 'draft.delete': return this.deleteDraft(userId, action.draftId);
      case 'account.search': return this.searchAccounts(userId, action.query);
      case 'role.grant': return this.grantRole(userId, action.userId, action.role);
      case 'role.revoke': return this.revokeRole(userId, action.userId);
      case 'term.list': return this.listTerms(userId, action.scopeKind, action.scopeKey);
      case 'term.save': return this.saveTerm(userId, action.edit);
    }
  }
}

/**
 * Publishing rules speak in English for operators; the editor shows them next to the block. Only
 * the rules are quoted: anything else that failed is reported as a failure, not as its own text.
 */
export function describeContentError(error: unknown): string[] {
  if (error instanceof z.ZodError) return error.issues.map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`).slice(0, 20);
  if (error instanceof ContentError) return [error.message];
  if (error instanceof Error && error.name === 'Error') return [error.message];
  return ['검증하지 못했어요. 잠시 후 다시 시도해 주세요.'];
}
