import 'server-only';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { ContentError } from '@/core/content-bundle';
import { toPublicClass, validateClass, type StoredClass } from '@/core/content';
import { importContent } from './content-store';
import { AppError } from './errors';
import {
  mayEditEveryDraft, mayPublish, pruneSections, suggestVersionId,
  type AuthoringResponse, type AuthoringRole, type AuthoringWorkspace, type DraftDetail, type DraftEdit, type DraftSummary,
} from '@/shared/authoring';

const id = z.string().min(1).max(191);
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
    contentBlocks: z.array(z.object({
      blockId: id,
      kind: z.string().min(1).max(100),
      typeVersion: z.number().int().min(1).max(999),
      required: z.boolean(),
      payload: z.record(z.string(), z.unknown()),
      fallback: z.string().max(2_000).optional(),
    }).strict()).max(100),
  }).strict()).min(1).max(50),
}).strict();

export const authoringActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('draft.create'), classKey: id }).strict(),
  z.object({ action: z.literal('draft.save'), draftId: id, edit: editSchema }).strict(),
  z.object({ action: z.literal('draft.validate'), draftId: id }).strict(),
  z.object({ action: z.literal('draft.publish'), draftId: id }).strict(),
  z.object({ action: z.literal('draft.delete'), draftId: id }).strict(),
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

/**
 * Content work is a role an account holds. The environment names the first administrators so a new
 * deployment has someone who can grant the rest; every other grant is a row a future teacher system
 * can write without touching this module's callers.
 */
export async function authoringRole(db: PrismaClient, userId: string): Promise<AuthoringRole | null> {
  if (openAuthoring()) return 'admin';
  const subjects = (process.env.CONTENT_ADMIN_SUBJECTS || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (subjects.length) {
    const identity = await db.googleIdentity.findUnique({ where: { userId } });
    if (identity && subjects.includes(identity.subject)) return 'admin';
  }
  const grant = await db.contentAuthor.findUnique({ where: { userId } });
  return grant?.role === 'admin' || grant?.role === 'author' ? grant.role : null;
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

  /** Answers live in the stored document; the editor receives sections and public problems only. */
  private detail(row: DraftRow, userId: string, issues: string[]): DraftDetail {
    const document = row.document as unknown as StoredClass;
    const edit: DraftEdit = {
      meta: { versionId: document.public.versionId, title: document.public.title, summary: document.public.summary, estimatedMinutes: document.public.estimatedMinutes },
      sections: structuredClone(document.sections),
    };
    let problems;
    try { problems = toPublicClass(document).problems; }
    // A draft may be mid-edit and fail whole-document validation; its questions are still public.
    catch { problems = document.problems.map((problem) => ({ problemVersionId: problem.problemVersionId, skillKeys: [...problem.skillKeys],
      promptContent: structuredClone(problem.promptContent), responseSpec: { ...problem.responseSpec }, hintAvailable: problem.hintAvailable })); }
    return { ...this.summary(row, userId), edit, problems, issues };
  }

  private async load(draftId: string, userId: string, role: AuthoringRole): Promise<DraftRow> {
    const row = await this.db.contentDraft.findUnique({ where: { id: draftId }, include: { author: { select: { displayName: true } } } });
    if (!row) throw new AppError(404, 'draft_missing', '초안을 찾을 수 없어요.');
    if (row.authorId !== userId && !mayEditEveryDraft(role)) throw new AppError(403, 'draft_not_yours', '다른 사람이 만든 초안이에요.');
    return row as DraftRow;
  }

  async workspace(userId: string): Promise<AuthoringWorkspace> {
    const role = await authoringRole(this.db, userId);
    if (!role) return { role: null, drafts: [], classes: [] };
    const [drafts, versions] = await Promise.all([
      this.db.contentDraft.findMany({ where: mayEditEveryDraft(role) ? {} : { authorId: userId },
        orderBy: { updatedAt: 'desc' }, take: 50, include: { author: { select: { displayName: true } } } }),
      this.db.classVersion.findMany({ orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }], select: { id: true, classKey: true, title: true } }),
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
      drafts: (drafts as DraftRow[]).map((row) => this.summary(row, userId)),
      classes: [...byKey.entries()].map(([classKey, entry]) => ({
        classKey, title: entry.title, latestVersionId: entry.versions[entry.versions.length - 1],
        suggestedVersionId: suggestVersionId(classKey, entry.versions), hasDraft: openDrafts.has(classKey),
      })),
    };
  }

  async createDraft(userId: string, classKey: string): Promise<AuthoringResponse> {
    await this.require(userId);
    const versions = await this.db.classVersion.findMany({ where: { classKey }, orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] });
    const base = versions[versions.length - 1];
    if (!base) throw new AppError(404, 'class_missing', '아직 발행된 적 없는 클래스예요. 새 클래스 작성은 다음 단계예요.');
    const document = structuredClone(base.document) as unknown as StoredClass;
    document.public.versionId = suggestVersionId(classKey, versions.map((version) => version.id));
    const row = await this.db.contentDraft.create({
      data: { classKey, versionId: document.public.versionId, baseVersionId: base.id, title: document.public.title,
        document: document as never, authorId: userId },
      include: { author: { select: { displayName: true } } },
    });
    return { workspace: await this.workspace(userId), draft: this.detail(row as DraftRow, userId, this.issues(document)) };
  }

  async saveDraft(userId: string, draftId: string, edit: DraftEdit): Promise<AuthoringResponse> {
    const role = await this.require(userId);
    const row = await this.load(draftId, userId, role);
    if (row.status === 'published') throw new AppError(409, 'draft_published', '이미 발행한 초안이에요. 새 초안을 만들어 주세요.');
    const document = this.merge(row.document as unknown as StoredClass, edit);
    const saved = await this.db.contentDraft.update({ where: { id: draftId },
      data: { document: document as never, versionId: document.public.versionId, title: document.public.title },
      include: { author: { select: { displayName: true } } } });
    return { workspace: await this.workspace(userId), draft: this.detail(saved as DraftRow, userId, this.issues(document)) };
  }

  /** Publishing writes the private half; the editor only ever sent sections and class wording. */
  private merge(stored: StoredClass, edit: DraftEdit): StoredClass {
    // A version belongs to its class. Without this, a draft could claim another class's version ID
    // and publish a record whose name says one class while its content teaches another.
    if (!edit.meta.versionId.startsWith(`${stored.public.classKey}:`)) {
      throw new AppError(422, 'version_scope', `판본 ID는 ${stored.public.classKey}: 로 시작해야 해요.`);
    }
    const sections = pruneSections(edit.sections);
    return {
      ...stored,
      public: { ...stored.public, versionId: edit.meta.versionId, title: edit.meta.title, summary: edit.meta.summary,
        estimatedMinutes: edit.meta.estimatedMinutes, sectionCount: sections.length },
      sections: sections as StoredClass['sections'],
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
    return { workspace: await this.workspace(userId), draft: this.detail(row, userId, issues) };
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
    return { workspace: await this.workspace(userId), draft: this.detail(published as DraftRow, userId, []), publishedVersionId: document.public.versionId };
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
