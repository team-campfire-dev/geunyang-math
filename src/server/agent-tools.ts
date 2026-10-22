import 'server-only';
import type { AgentKey, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AgentService } from './agent';
import { authoringActionSchema } from './authoring';
import { AppError } from './errors';
import { FeedbackService } from './feedback-service';
import {
  blockForms, nextBlockId, nextProblemBlockId, nextProblemVersionId, nextSectionId, problemGist, sectionRoles,
  type DraftDetail, type DraftEdit, type DraftProblem,
} from '@/shared/authoring';
import type { ContentBlock, LessonSection } from '@/shared/api';

/**
 * Lesson editing as tools a chat model calls. A model in a chat window writes a lesson a piece at a
 * time — a paragraph here, a question there — so each tool changes one named thing and the server
 * puts it into the whole draft: it reads the draft as it stands, makes the change, and saves it with
 * the same check against a newer save that the raw API asks for. A model never has to send a whole
 * lesson back to change one sentence, which is where a long document would come back damaged.
 *
 * Every change still goes through the editor's own save and its own rules, as the code's account.
 */

type Json = Record<string, unknown>;
export type ToolContext = { db: PrismaClient; key: AgentKey; agent: AgentService };
type Tool = {
  name: string; title: string; description: string;
  input: z.ZodObject;
  readOnly?: boolean; destructive?: boolean; publishes?: boolean;
  run: (context: ToolContext, args: Json) => Promise<unknown>;
};

const id = z.string().min(1).max(191);
const draftId = id.describe('초안 id (list_lessons, open_lesson_draft, read_draft가 알려 준 draftId)');
const payload = z.record(z.string(), z.unknown()).describe('블록의 payload. 종류마다 형식이 다르니 get_guide의 blocks[].payloadSchema와 example을 따르세요.');
const gradingSpec = (authoringActionSchema.options.find((option) => option.shape.action.value === 'draft.save')!
  .shape as { edit: z.ZodObject }).edit.shape.problems as z.ZodArray<z.ZodObject>;
const problemShape = gradingSpec.element.shape;

/** One line that says what a block holds, so an outline can be read without the payloads. */
function gist(block: ContentBlock): string {
  const value = block.payload;
  const text = [value.text, value.caption, value.alt, value.prompt].find((item) => typeof item === 'string' && item.trim()) as string | undefined;
  return text ? text.replace(/\s+/g, ' ').slice(0, 60) : block.kind;
}

/** The draft as a model needs it after a change: every name it can point at, and what is still wrong. */
function outline(detail: DraftDetail) {
  const problems = new Map(detail.edit.problems.map((problem) => [problem.problemVersionId, problem]));
  return {
    draftId: detail.id, lessonKey: detail.lessonKey, versionId: detail.versionId, status: detail.status, updatedAt: detail.updatedAt,
    title: detail.edit.meta.title,
    sections: detail.edit.sections.map((section) => ({
      sectionId: section.sectionId, role: section.role, title: section.title,
      blocks: section.contentBlocks.map((block) => ({
        blockId: block.blockId, kind: `${block.kind}@${block.typeVersion}`, gist: gist(block),
        ...(block.kind === 'core.problem_set' ? { problems: ((block.payload.problemVersionIds as string[]) ?? []).map((problemVersionId) => ({
          problemVersionId, gist: problems.get(problemVersionId) ? problemGist(problems.get(problemVersionId)!, 60) : '(없는 문항)' })) } : {}),
      })),
    })),
    issues: detail.issues.slice(0, 20),
  };
}

/** The whole draft, for reading: the outline's names with every payload and answer in place. */
const full = (detail: DraftDetail) => ({
  draftId: detail.id, lessonKey: detail.lessonKey, versionId: detail.versionId, baseVersionId: detail.baseVersionId,
  status: detail.status, mine: detail.mine, authorName: detail.authorName, updatedAt: detail.updatedAt,
  edit: detail.edit, issues: detail.issues,
});

const allBlockIds = (edit: DraftEdit) => [
  ...edit.sections.flatMap((section) => section.contentBlocks.map((block) => block.blockId)),
  ...edit.problems.flatMap((problem) => [...problem.promptContent, ...problem.hints, ...problem.solution].map((block) => block.blockId)),
];
const missing = (what: string) => new AppError(404, 'not_found', `${what}을(를) 이 초안에서 찾지 못했어요. read_draft로 지금 이름을 확인해 주세요.`);

function sectionOf(edit: DraftEdit, sectionId: string): LessonSection {
  const section = edit.sections.find((item) => item.sectionId === sectionId);
  if (!section) throw missing(`단계 ${sectionId}`);
  return section;
}
/** Where a block lives: a step's list, or one part of a question. */
function holderOf(edit: DraftEdit, blockId: string): { list: ContentBlock[]; section?: LessonSection; problem?: DraftProblem } {
  for (const section of edit.sections) if (section.contentBlocks.some((block) => block.blockId === blockId)) return { list: section.contentBlocks, section };
  for (const problem of edit.problems) {
    for (const list of [problem.promptContent, problem.hints, problem.solution]) if (list.some((block) => block.blockId === blockId)) return { list, problem };
  }
  throw missing(`블록 ${blockId}`);
}
function activityOf(edit: DraftEdit, problemVersionId: string): ContentBlock | undefined {
  return edit.sections.flatMap((section) => section.contentBlocks).find((block) =>
    block.kind === 'core.problem_set' && ((block.payload.problemVersionIds as string[]) ?? []).includes(problemVersionId));
}
/** A question no activity and no review pool names any more is not part of the lesson. */
function dropUnheld(edit: DraftEdit) {
  const held = new Set([
    ...edit.sections.flatMap((section) => section.contentBlocks).filter((block) => block.kind === 'core.problem_set')
      .flatMap((block) => (block.payload.problemVersionIds as string[]) ?? []),
    ...(edit.reviewProblemIds ?? []),
  ]);
  edit.problems = edit.problems.filter((problem) => held.has(problem.problemVersionId));
}
function place<T>(list: T[], item: T, index?: number) {
  const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, item);
}
const textBlock = (blockId: string, text: string): ContentBlock => ({ blockId, kind: 'core.rich_text', typeVersion: 3, required: true, payload: { text, definitions: [] } });

/**
 * Reads the draft as it is now, lets `change` write into a copy, and saves that copy, refusing if
 * someone saved in between. Returns the outline of what the server kept, which may differ from what
 * was sent: it prunes empty optional fields, and renames a published question that was changed.
 */
async function change(context: ToolContext, id: string, write: (edit: DraftEdit, detail: DraftDetail) => void) {
  const detail = await context.agent.draft(id);
  if (detail.status === 'published') throw new AppError(409, 'draft_published', '이미 발행한 초안이에요. open_lesson_draft로 새 초안을 여세요.');
  const edit = structuredClone(detail.edit);
  write(edit, detail);
  const response = await context.agent.act({ action: 'draft.save', draftId: id, baseUpdatedAt: detail.updatedAt, edit });
  return outline(response.draft!);
}

const tools: Tool[] = [
  {
    name: 'get_guide', title: '작성 안내 읽기', readOnly: true,
    description: '처음에 한 번 읽으세요. 이 연결의 계정·권한, 작업 규칙, 블록 종류마다 payload 형식과 예시, 「그냥수학」 작성 지침 전문을 돌려줘요.',
    input: z.object({}),
    run: async ({ agent }) => {
      const { you, rules, blocks, writingGuide } = await agent.guide();
      return { you, rules, blocks, writingGuide };
    },
  },
  {
    name: 'list_lessons', title: '코스와 수업 목록', readOnly: true,
    description: '코스마다 수업(lessonKey, 제목, 최신 발행판)과 열린 초안을 보여 줘요. courseKey를 주면 그 코스만 보여 줘요.',
    input: z.object({ courseKey: z.string().max(100).optional() }),
    run: async ({ agent }, args) => {
      const workspace = await agent.workspace();
      const open = workspace.drafts.filter((draft) => draft.status !== 'published');
      return workspace.courses.filter((course) => !args.courseKey || course.key === args.courseKey).map((course) => ({
        courseKey: course.key, title: course.title,
        lessons: workspace.lessons.filter((lesson) => lesson.courseKey === course.key).map((lesson) => ({
          lessonKey: lesson.lessonKey, title: lesson.title, latestVersionId: lesson.latestVersionId,
          openDrafts: open.filter((draft) => draft.lessonKey === lesson.lessonKey).map((draft) => ({
            draftId: draft.id, status: draft.status, mine: draft.mine, authorName: draft.authorName, updatedAt: draft.updatedAt })),
        })),
      }));
    },
  },
  {
    name: 'list_concepts', title: '개념 찾기', readOnly: true,
    description: '수업·문항의 conceptKeys에 쓰는 개념을 찾아요. query로 키나 이름의 일부를 주면 맞는 것만 보여 줘요.',
    input: z.object({ query: z.string().max(100).optional() }),
    run: async ({ agent }, args) => {
      const query = String(args.query ?? '').trim().toLowerCase();
      return (await agent.workspace()).concepts
        .filter((concept) => !query || concept.key.toLowerCase().includes(query) || concept.label.toLowerCase().includes(query)).slice(0, 200);
    },
  },
  {
    name: 'open_lesson_draft', title: '수업 초안 열기',
    description: '수업을 고치려면 먼저 이것을 부르세요. 그 수업에 열린 초안이 있으면 그것을, 없으면 최신 발행판을 복사한 새 초안을 열어 개요를 돌려줘요. 남이 쓰던 초안(mine: false)이면 고치기 전에 사람에게 물어보세요.',
    input: z.object({ lessonKey: id }),
    run: async ({ agent }, args) => {
      const workspace = await agent.workspace();
      const existing = workspace.drafts.find((draft) => draft.lessonKey === args.lessonKey && draft.status !== 'published');
      if (existing) return { opened: 'existing', mine: existing.mine, authorName: existing.authorName, ...outline(await agent.draft(existing.id)) };
      const response = await agent.act({ action: 'draft.create', lessonKey: args.lessonKey });
      return { opened: 'new', ...outline(response.draft!) };
    },
  },
  {
    name: 'read_draft', title: '초안 전체 읽기', readOnly: true,
    description: '초안의 모든 단계·블록 payload·문항(정답·힌트·해설 포함)과 남은 문제(issues)를 돌려줘요. 블록을 고치기 전에 지금 내용을 확인할 때 써요.',
    input: z.object({ draftId }),
    run: async ({ agent }, args) => full(await agent.draft(String(args.draftId))),
  },
  {
    name: 'read_published_lesson', title: '발행된 수업 읽기', readOnly: true,
    description: '발행된 판본 하나(versionId, 예: fraction-meaning:v3)를 읽어요. 고칠 수는 없고, 고치려면 open_lesson_draft를 써요.',
    input: z.object({ versionId: id }),
    run: async ({ agent }, args) => full((await agent.act({ action: 'lesson.read', versionId: args.versionId })).draft!),
  },
  {
    name: 'create_lesson', title: '새 수업 만들기',
    description: '코스에 아직 없는 새 수업을 만들고 첫 초안을 열어요. lessonKey는 영문 소문자·숫자·하이픈이고 한 번 정하면 바꿀 수 없어요. 설명과 연습 두 단계로 시작해요.',
    input: z.object({ courseKey: id.max(100), lessonKey: id.max(100), title: z.string().min(1).max(191), conceptKeys: z.array(id.max(100)).max(50) }),
    run: async ({ agent }, args) => outline((await agent.act({ action: 'lesson.create', ...args })).draft!),
  },
  {
    name: 'update_lesson_info', title: '수업 정보 고치기',
    description: '제목·소개·예상 시간(분)·가르치는 개념·전제 개념 중 준 것만 바꿔요.',
    input: z.object({ draftId, title: z.string().max(191).optional(), summary: z.string().max(500).optional(),
      estimatedMinutes: z.number().int().min(0).max(240).optional(), conceptKeys: z.array(id.max(100)).max(50).optional(),
      prerequisiteConceptKeys: z.array(id.max(100)).max(50).optional() }),
    run: (context, { draftId: target, ...fields }) => change(context, String(target), (edit) => {
      for (const [name, value] of Object.entries(fields)) if (value !== undefined) (edit.meta as Json)[name] = value;
    }),
  },
  {
    name: 'add_section', title: '단계 더하기',
    description: `단계를 더해요. role은 ${sectionRoles.join('·')} 중 하나예요. index를 주면 그 자리에, 없으면 끝에 넣어요. 본문은 add_block으로 채워요.`,
    input: z.object({ draftId, role: z.enum(sectionRoles as [LessonSection['role'], ...LessonSection['role'][]]), title: z.string().min(1).max(500),
      index: z.number().int().min(0).optional() }),
    run: (context, args) => change(context, String(args.draftId), (edit, detail) => {
      const sectionId = nextSectionId(detail.lessonKey, String(args.role), edit.meta.versionId, edit.sections.map((section) => section.sectionId));
      place(edit.sections, { sectionId, role: args.role as LessonSection['role'], title: String(args.title), contentBlocks: [] }, args.index as number | undefined);
    }),
  },
  {
    name: 'update_section', title: '단계 고치기',
    description: '단계의 제목이나 역할(role)을 바꿔요.',
    input: z.object({ draftId, sectionId: id, title: z.string().min(1).max(500).optional(),
      role: z.enum(sectionRoles as [LessonSection['role'], ...LessonSection['role'][]]).optional() }),
    run: (context, args) => change(context, String(args.draftId), (edit) => {
      const section = sectionOf(edit, String(args.sectionId));
      if (args.title !== undefined) section.title = String(args.title);
      if (args.role !== undefined) section.role = args.role as LessonSection['role'];
    }),
  },
  {
    name: 'move_section', title: '단계 옮기기',
    description: '단계를 index 자리(0부터)로 옮겨요.',
    input: z.object({ draftId, sectionId: id, index: z.number().int().min(0) }),
    run: (context, args) => change(context, String(args.draftId), (edit) => {
      const section = sectionOf(edit, String(args.sectionId));
      edit.sections.splice(edit.sections.indexOf(section), 1);
      place(edit.sections, section, Number(args.index));
    }),
  },
  {
    name: 'remove_section', title: '단계 지우기', destructive: true,
    description: '단계를 지워요. 그 단계의 활동이 가진 문항도 함께 빠져요. 초안에서만 빠지고 발행된 판본은 그대로예요.',
    input: z.object({ draftId, sectionId: id }),
    run: (context, args) => change(context, String(args.draftId), (edit) => {
      const section = sectionOf(edit, String(args.sectionId));
      if (edit.sections.length === 1) throw new AppError(422, 'last_section', '수업에는 단계가 하나 이상 있어야 해요.');
      edit.sections.splice(edit.sections.indexOf(section), 1);
      if (section.contentBlocks.some((block) => block.blockId === edit.reviewBlockId)) edit.reviewBlockId = null;
      dropUnheld(edit);
    }),
  },
  {
    name: 'add_block', title: '블록 더하기',
    description: '단계(sectionId) 또는 문항의 한 부분(problemVersionId + part: prompt·hints·solution)에 블록을 더해요. 형식은 get_guide의 blocks를 따르세요. 문항 활동(core.problem_set)은 payload 없이 만들고, 문항은 add_problem으로 넣어요. afterBlockId를 주면 그 뒤에, 없으면 끝에 넣어요.',
    input: z.object({ draftId, sectionId: id.optional(), problemVersionId: id.optional(), part: z.enum(['prompt', 'hints', 'solution']).optional(),
      kind: z.string().max(100), typeVersion: z.number().int().min(1), payload: payload.optional(), afterBlockId: id.optional() }),
    run: (context, args) => change(context, String(args.draftId), (edit, detail) => {
      const form = blockForms.find((item) => item.kind === args.kind && item.typeVersion === args.typeVersion && !item.retired);
      if (!form) throw new AppError(422, 'block_kind', `쓸 수 없는 블록이에요: ${args.kind}@${args.typeVersion}. get_guide의 blocks에서 고르세요.`);
      const taken = allBlockIds(edit);
      let list: ContentBlock[];
      let blockId: string;
      if (args.sectionId) {
        const section = sectionOf(edit, String(args.sectionId));
        list = section.contentBlocks;
        blockId = nextBlockId(detail.lessonKey, section.sectionId, form.kind, edit.meta.versionId, taken);
      } else if (args.problemVersionId && args.part) {
        const problem = edit.problems.find((item) => item.problemVersionId === args.problemVersionId);
        if (!problem) throw missing(`문항 ${args.problemVersionId}`);
        if (form.kind === 'core.problem_set') throw new AppError(422, 'block_kind', '문항 안에는 활동을 넣을 수 없어요.');
        const part = args.part as 'prompt' | 'hints' | 'solution';
        list = part === 'prompt' ? problem.promptContent : problem[part];
        blockId = nextProblemBlockId(problem.problemVersionId, part === 'hints' ? 'hint' : part, taken);
      } else throw new AppError(422, 'block_place', 'sectionId, 또는 problemVersionId와 part를 함께 주세요.');
      const body = form.kind === 'core.problem_set' ? form.create() : (args.payload as Json | undefined) ?? form.create();
      const after = args.afterBlockId ? list.findIndex((block) => block.blockId === args.afterBlockId) : -1;
      if (args.afterBlockId && after < 0) throw missing(`블록 ${args.afterBlockId}`);
      place(list, { blockId, kind: form.kind, typeVersion: form.typeVersion, required: true, payload: body }, after < 0 ? undefined : after + 1);
    }),
  },
  {
    name: 'update_block', title: '블록 고치기',
    description: '블록 하나의 payload를 통째로 바꿔요. 단계의 블록이든 문항의 지문·힌트·해설 블록이든 blockId로 찾아요. 글 블록이면 {"text": "...", "definitions": [...]} 처럼 전체를 보내요. 활동(core.problem_set)의 문항은 add_problem·remove_problem·move_problem으로 바꿔요.',
    input: z.object({ draftId, blockId: id, payload }),
    run: (context, args) => change(context, String(args.draftId), (edit) => {
      const { list } = holderOf(edit, String(args.blockId));
      const block = list.find((item) => item.blockId === args.blockId)!;
      if (block.kind === 'core.problem_set') throw new AppError(422, 'activity_payload', '활동의 문항은 add_problem·remove_problem·move_problem으로 바꿔요.');
      block.payload = args.payload as Json;
    }),
  },
  {
    name: 'move_block', title: '블록 옮기기',
    description: '블록을 같은 목록 안 index 자리(0부터)로, 또는 toSectionId를 주면 다른 단계의 index 자리로 옮겨요.',
    input: z.object({ draftId, blockId: id, index: z.number().int().min(0), toSectionId: id.optional() }),
    run: (context, args) => change(context, String(args.draftId), (edit) => {
      const { list, section } = holderOf(edit, String(args.blockId));
      const block = list.find((item) => item.blockId === args.blockId)!;
      if (args.toSectionId && !section) throw new AppError(422, 'block_place', '문항 안의 블록은 단계로 옮길 수 없어요.');
      list.splice(list.indexOf(block), 1);
      place(args.toSectionId ? sectionOf(edit, String(args.toSectionId)).contentBlocks : list, block, Number(args.index));
    }),
  },
  {
    name: 'remove_block', title: '블록 지우기', destructive: true,
    description: '블록을 지워요. 활동(core.problem_set)을 지우면 그 문항도 함께 빠져요.',
    input: z.object({ draftId, blockId: id }),
    run: (context, args) => change(context, String(args.draftId), (edit) => {
      const { list } = holderOf(edit, String(args.blockId));
      list.splice(list.findIndex((block) => block.blockId === args.blockId), 1);
      if (edit.reviewBlockId === args.blockId) edit.reviewBlockId = null;
      dropUnheld(edit);
    }),
  },
  {
    name: 'add_problem', title: '문항 더하기',
    description: '활동(core.problem_set 블록)에 문항을 더해요. prompt는 지문 글이고 $...$ 수식을 쓸 수 있어요. gradingSpec이 정답이에요: {"kind":"integer","value":3}, {"kind":"rational","numerator":3,"denominator":4}, {"kind":"expression","expression":"2*sqrt(3)"}, {"kind":"choice","options":[{"id":"a","text":"..."}],"correct":"a"}. hints·solution은 글 목록이에요. 그림이 필요하면 만든 뒤 add_block으로 더하세요.',
    input: z.object({ draftId, activityBlockId: id, prompt: z.string().min(1).max(20_000), gradingSpec: problemShape.gradingSpec,
      conceptKeys: z.array(id.max(100)).max(50).optional(), hints: z.array(z.string().min(1).max(20_000)).max(10).optional(),
      solution: z.array(z.string().min(1).max(20_000)).max(10).optional(), misreadings: problemShape.misreadings,
      afterProblemVersionId: id.optional() }),
    run: (context, args) => change(context, String(args.draftId), (edit, detail) => {
      const section = edit.sections.find((item) => item.contentBlocks.some((block) => block.blockId === args.activityBlockId));
      const activity = section?.contentBlocks.find((block) => block.blockId === args.activityBlockId);
      if (!section || !activity || activity.kind !== 'core.problem_set') throw missing(`활동 ${args.activityBlockId}`);
      const problemVersionId = nextProblemVersionId(detail.lessonKey, section.role, edit.meta.versionId, edit.problems.map((problem) => problem.problemVersionId));
      const taken = allBlockIds(edit);
      const named = (part: 'prompt' | 'hint' | 'solution', text: string) => { const block = textBlock(nextProblemBlockId(problemVersionId, part, taken), text); taken.push(block.blockId); return block; };
      const ids = (activity.payload.problemVersionIds as string[]) ?? [];
      const problem: DraftProblem = {
        problemVersionId,
        conceptKeys: (args.conceptKeys as string[] | undefined) ?? edit.problems.find((item) => ids.includes(item.problemVersionId))?.conceptKeys ?? edit.meta.conceptKeys.slice(0, 1),
        promptContent: [named('prompt', String(args.prompt))],
        gradingSpec: args.gradingSpec as DraftProblem['gradingSpec'],
        hints: ((args.hints as string[] | undefined) ?? []).map((text) => named('hint', text)),
        solution: ((args.solution as string[] | undefined) ?? []).map((text) => named('solution', text)),
        ...(args.misreadings ? { misreadings: args.misreadings as DraftProblem['misreadings'] } : {}),
      };
      edit.problems.push(problem);
      const after = args.afterProblemVersionId ? ids.indexOf(String(args.afterProblemVersionId)) : -1;
      const next = [...ids];
      place(next, problemVersionId, after < 0 ? undefined : after + 1);
      activity.payload = { ...activity.payload, problemVersionIds: next };
    }),
  },
  {
    name: 'update_problem', title: '문항의 정답·개념 고치기',
    description: '문항의 정답(gradingSpec), 개념(conceptKeys), 예상 오답(misreadings) 중 준 것만 바꿔요. 지문·힌트·해설의 글은 그 블록의 blockId로 update_block을 쓰세요. 발행된 문항을 고치면 저장할 때 새 problemVersionId가 붙어요 — 돌아온 개요의 이름을 쓰세요.',
    input: z.object({ draftId, problemVersionId: id, gradingSpec: problemShape.gradingSpec.optional(),
      conceptKeys: z.array(id.max(100)).max(50).optional(), misreadings: problemShape.misreadings }),
    run: (context, args) => change(context, String(args.draftId), (edit) => {
      const problem = edit.problems.find((item) => item.problemVersionId === args.problemVersionId);
      if (!problem) throw missing(`문항 ${args.problemVersionId}`);
      if (args.gradingSpec) problem.gradingSpec = args.gradingSpec as DraftProblem['gradingSpec'];
      if (args.conceptKeys) problem.conceptKeys = args.conceptKeys as string[];
      if (args.misreadings) problem.misreadings = args.misreadings as DraftProblem['misreadings'];
    }),
  },
  {
    name: 'move_problem', title: '문항 옮기기',
    description: '문항을 그 활동 안 index 자리(0부터)로 옮겨요.',
    input: z.object({ draftId, problemVersionId: id, index: z.number().int().min(0) }),
    run: (context, args) => change(context, String(args.draftId), (edit) => {
      const activity = activityOf(edit, String(args.problemVersionId));
      if (!activity) throw missing(`문항 ${args.problemVersionId}`);
      const ids = ((activity.payload.problemVersionIds as string[]) ?? []).filter((item) => item !== args.problemVersionId);
      place(ids, String(args.problemVersionId), Number(args.index));
      activity.payload = { ...activity.payload, problemVersionIds: ids };
    }),
  },
  {
    name: 'remove_problem', title: '문항 지우기', destructive: true,
    description: '문항을 활동에서 빼고 초안에서 지워요.',
    input: z.object({ draftId, problemVersionId: id }),
    run: (context, args) => change(context, String(args.draftId), (edit) => {
      const activity = activityOf(edit, String(args.problemVersionId));
      if (!activity && !edit.reviewProblemIds?.includes(String(args.problemVersionId))) throw missing(`문항 ${args.problemVersionId}`);
      if (activity) activity.payload = { ...activity.payload, problemVersionIds: ((activity.payload.problemVersionIds as string[]) ?? []).filter((item) => item !== args.problemVersionId) };
      if (edit.reviewProblemIds) edit.reviewProblemIds = edit.reviewProblemIds.filter((item) => item !== args.problemVersionId);
      dropUnheld(edit);
    }),
  },
  {
    name: 'validate_draft', title: '발행 규칙으로 검사', readOnly: true,
    description: '초안을 발행 규칙으로 검사해 issues를 돌려줘요. 각 issue에는 sectionId·blockId·problemVersionId·field가 붙어 어디를 고칠지 알려 줘요. 비어야 발행할 수 있어요.',
    input: z.object({ draftId }),
    run: async ({ agent }, args) => outline((await agent.act({ action: 'draft.validate', draftId: args.draftId })).draft!),
  },
  {
    name: 'try_answer', title: '문항에 답해 보기', readOnly: true,
    description: '초안의 문항에 답을 넣어 채점 결과를 봐요. 정답과 흔한 오답이 의도대로 채점되는지 확인할 때 써요.',
    input: z.object({ draftId, problemVersionId: id, answer: z.string().min(1).max(100) }),
    run: async ({ agent }, args) => (await agent.act({ action: 'draft.tryAnswer', draftId: args.draftId, problemVersionId: args.problemVersionId,
      answer: args.answer, assisted: false })).tried,
  },
  {
    name: 'wrong_answers', title: '학습자의 실제 오답', readOnly: true,
    description: '발행된 문항에 학습자가 실제로 쓴 오답을 많은 순서로 봐요. 힌트·해설·예상 오답을 고칠 근거로 써요.',
    input: z.object({ problemVersionId: id }),
    run: async ({ agent }, args) => (await agent.act({ action: 'problem.wrongAnswers', problemVersionId: args.problemVersionId })).wrongAnswers,
  },
  {
    name: 'lesson_feedback', title: '수업 의견 읽기', readOnly: true,
    description: '학습자가 수업을 하다가 남긴 의견을 봐요. 어느 단계(sectionId)·블록(blockId)·문제(problemVersionId)에 남겼는지, 끌어 고른 글(quote)이 무엇인지 함께 와요. reason은 한 번에 누른 빠른 답(confusing 헷갈려요 · hard 어려워요 · wrong 틀린 것 같아요 · broken 화면이 이상해요 · good 이해됐어요)이고 body는 직접 쓴 말이에요(없으면 빈 문자열). current가 false면 그 뒤에 고쳐진 자리라 지금 판본과 다를 수 있어요. 운영자 코드로만 읽을 수 있어요.',
    input: z.object({ lessonKey: z.string().max(100).optional().describe('이 수업의 의견만'), status: z.enum(['open', 'resolved', 'all']).default('open') }),
    run: async ({ db, key }, args) => (await new FeedbackService(db).inbox(key.userId)).entries
      .filter((entry) => (!args.lessonKey || entry.lessonKey === args.lessonKey) && (args.status === 'all' || entry.status === (args.status ?? 'open')))
      // Who wrote it stays here: the model needs the place and the words, not the learner's name.
      .map(({ author: _author, ...entry }) => entry),
  },
  {
    name: 'resolve_feedback', title: '수업 의견 처리함',
    description: '반영한 의견을 처리함으로 표시해요. 초안을 고쳐 의견을 반영했을 때 쓰고, 반영하지 않기로 했으면 이유를 사람에게 보고하세요.',
    input: z.object({ feedbackId: id }),
    run: async ({ db, key }, args) => {
      await new FeedbackService(db).act(key.userId, { action: 'feedback.resolve', feedbackId: args.feedbackId });
      return { resolved: args.feedbackId };
    },
  },
  {
    name: 'list_definitions', title: '뜻풀이 목록', readOnly: true,
    description: '글 블록의 definitions로 걸 수 있는 뜻풀이를 봐요. scopeKind global은 공통 사전(scopeKey는 빈 문자열), lesson은 그 수업만의 뜻풀이(scopeKey = lessonKey)예요.',
    input: z.object({ scopeKind: z.enum(['global', 'lesson']), scopeKey: z.string().max(100) }),
    run: async ({ agent }, args) => (await agent.act({ action: 'definition.list', scopeKind: args.scopeKind, scopeKey: args.scopeKey })).definitions,
  },
  {
    name: 'request_review', title: '검토 요청',
    description: '고친 초안을 사람에게 검토해 달라고 표시해요(asking: false면 거둬요). 발행은 사람이 편집 화면에서 해요. 끝나면 무엇을 왜 바꿨는지 짧게 보고하세요.',
    input: z.object({ draftId, asking: z.boolean().default(true) }),
    run: async ({ agent }, args) => outline((await agent.act({ action: 'draft.review', draftId: args.draftId, asking: args.asking ?? true })).draft!),
  },
  {
    name: 'publish_draft', title: '발행', publishes: true, destructive: true,
    description: '초안을 새 판본으로 발행해요. 그때부터 새로 시작하는 학습자가 이것을 받아요. 사람이 발행하라고 했을 때만 쓰세요.',
    input: z.object({ draftId }),
    run: async ({ agent }, args) => {
      const response = await agent.act({ action: 'draft.publish', draftId: args.draftId });
      return { publishedVersionId: response.publishedVersionId, carriedLessons: response.carriedLessons ?? [] };
    },
  },
];

/** The tools a key reaches: the ones that publish only for a key made to publish. */
export const toolsFor = (key: AgentKey) => tools.filter((tool) => !tool.publishes || key.mayPublish);

export function describeTools(key: AgentKey) {
  return toolsFor(key).map((tool) => ({
    name: tool.name, title: tool.title, description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { unrepresentable: 'any', io: 'input' }),
    annotations: { title: tool.title, readOnlyHint: !!tool.readOnly, destructiveHint: !!tool.destructive, idempotentHint: !!tool.readOnly, openWorldHint: false },
  }));
}

/** A refusal as a model can act on it: what was wrong, and where, in words it can repair from. */
function refusal(error: unknown): string {
  if (error instanceof z.ZodError) return `입력이 형식에 맞지 않아요: ${error.issues.slice(0, 10).map((issue) => `${issue.path.join('.') || '(전체)'}: ${issue.message}`).join('; ')}`;
  if (error instanceof AppError) return error.message;
  return '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

/** Runs one tool. A refusal is a result the model reads and repairs from, not a protocol error. */
export async function callTool(context: ToolContext, name: string, input: unknown) {
  const tool = toolsFor(context.key).find((item) => item.name === name);
  if (!tool) return { content: [{ type: 'text', text: `없는 도구예요: ${name}` }], isError: true };
  try {
    const result = await tool.run(context, tool.input.parse(input ?? {}) as Json);
    return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
  } catch (error) {
    if (!(error instanceof z.ZodError) && !(error instanceof AppError)) {
      console.error(JSON.stringify({ event: 'agent_tool_failed', tool: name, type: error instanceof Error ? error.name : 'unknown' }));
    }
    return { content: [{ type: 'text', text: refusal(error) }], isError: true };
  }
}
