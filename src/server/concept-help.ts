import 'server-only';
import type { PrismaClient } from '@prisma/client';
import type { ConceptHelp, GradeResult, PublicLesson } from '@/shared/api';
import { leafGlossary, withoutDefinitionLinks } from '@/shared/definition-exploration';
import { definitionRefId, type DefinitionRef } from '@/shared/rich-text';
import { parseAssignmentPolicy } from '@/core/assignment';
import { blockDefinitionRefs } from '@/core/content';
import { glossaryEntries } from '@/core/glossary';
import { currentDefinitions, lessonRecord, publishedProblemRecords } from './content-store';
import { AppError } from './errors';

/** Answer ownership and result visibility are checked here, not inferred from the client card. */
export async function loadConceptHelp(db: PrismaClient, userId: string, attemptId: string, catalog: () => Promise<PublicLesson[]>): Promise<ConceptHelp> {
  const unavailable = () => new AppError(404, 'concept_help_unavailable', '이 답안의 개념 설명을 열 수 없어요. 학습 화면을 다시 확인해 주세요.');
  const attempt = await db.attempt.findFirst({
    where: { id: attemptId, userId, learningScope: { ownerUserId: userId, kind: 'personal' } },
    include: {
      enrollment: { include: { lessonVersion: { include: { lesson: { include: { course: true } } } } } },
      submission: { include: { recipient: { include: { assignment: true, sourceEnrollment: { include: { lessonVersion: true } } } } } },
      assignmentItem: true,
    },
  });
  if (!attempt) throw unavailable();
  let courseKey: string | undefined;
  let preferredLesson: string | undefined;
  let heldVersion: string | undefined;
  if (attempt.submission) {
    const { recipient } = attempt.submission;
    if (recipient.learnerUserId !== userId || attempt.assignmentItem?.assignmentId !== recipient.assignmentId
      || attempt.assignmentItem.problemVersionId !== attempt.problemVersionId) throw unavailable();
    // Check the policy before inspecting the private grade: a withheld exam must reveal neither
    // its verdict nor the existence of help, even through a direct request with a known attempt id.
    if (parseAssignmentPolicy(recipient.assignment.policy).results === 'after-submission' && attempt.submission.status !== 'submitted') throw unavailable();
    preferredLesson = recipient.sourceEnrollment?.lessonVersion.lessonKey;
    heldVersion = recipient.sourceEnrollment?.lessonVersionId;
    if (recipient.assignment.problemSetVersionId) {
      const set = await db.problemSetVersion.findUnique({ where: { id: recipient.assignment.problemSetVersionId }, include: { problemSet: { include: { course: true } } } });
      courseKey = set?.problemSet.course.key;
    }
  } else if (attempt.enrollment) {
    if (attempt.enrollment.userId !== userId) throw unavailable();
    preferredLesson = attempt.enrollment.lessonVersion.lessonKey;
    heldVersion = attempt.enrollment.lessonVersionId;
    courseKey = attempt.enrollment.lessonVersion.lesson.course.key;
    const record = await lessonRecord(db, heldVersion);
    if (!record?.problems.some(problem => problem.problemVersionId === attempt.problemVersionId)) throw unavailable();
  } else throw unavailable();
  if ((attempt.result as GradeResult).status !== 'incorrect') throw unavailable();
  const problem = (await publishedProblemRecords(db, [attempt.problemVersionId])).get(attempt.problemVersionId);
  if (!problem) throw unavailable();
  if (!courseKey) {
    const owners = await db.publishedProblem.findMany({ where: { problemVersionId: problem.problemVersionId }, select: { ownerVersionId: true } });
    const set = await db.problemSetVersion.findFirst({ where: { id: { in: owners.map(owner => owner.ownerVersionId) } },
      orderBy: { id: 'asc' }, include: { problemSet: { include: { course: true } } } });
    courseKey = set?.problemSet.course.key;
  }
  const lessons = await catalog();
  const labels = new Map((await db.concept.findMany({ where: { key: { in: problem.conceptKeys } }, select: { key: true, label: true } })).map(item => [item.key, item.label]));
  // Stay in the question's course. A concept key reused elsewhere is not permission to substitute
  // a different level of mathematics. Keep the learner's held lesson version when applicable.
  const held = heldVersion ? await lessonRecord(db, heldVersion) : null;
  const teachers = lessons.filter(lesson => lesson.courseKey === courseKey).map(lesson =>
    held && lesson.lessonKey === preferredLesson ? { ...held.public, courseKey: lesson.courseKey } : lesson);
  const selected = problem.conceptKeys.map(key => ({ key, lesson: teachers.find(lesson => lesson.lessonKey === preferredLesson && lesson.conceptKeys.includes(key))
    ?? teachers.find(lesson => lesson.conceptKeys.includes(key)) }));
  const versions = [...new Set(selected.flatMap(({ lesson }) => lesson ? [lesson.lessonKey === preferredLesson && heldVersion ? heldVersion : lesson.versionId] : []))];
  const records = new Map(await Promise.all(versions.map(async version => [version, await lessonRecord(db, version)] as const)));
  const concepts = await Promise.all(selected.map(async ({ key, lesson }) => {
    const record = lesson && records.get(lesson.lessonKey === preferredLesson && heldVersion ? heldVersion : lesson.versionId);
    const explanations = record?.sections.filter(section => section.role === 'explanation') ?? [];
    const linked = blockDefinitionRefs([...explanations.flatMap(section => section.contentBlocks), ...problem.promptContent]);
    const candidates: DefinitionRef[] = [
      ...linked.filter(ref => ref.conceptKey === key && ref.scopeKind === 'lesson' && ref.scopeKey === lesson?.lessonKey),
      ...linked.filter(ref => ref.conceptKey === key && ref.scopeKind === 'course' && ref.scopeKey === courseKey),
      { conceptKey: key },
    ];
    const definitions = await currentDefinitions(db, candidates);
    const definition = candidates.map(ref => definitions.find(item => definitionRefId(item) === definitionRefId(ref))).find(Boolean);
    const matching = explanations.filter(section => blockDefinitionRefs(section.contentBlocks).some(ref => ref.conceptKey === key));
    const sections = (matching.length ? matching : explanations).map(section => ({ sectionId: section.sectionId, title: section.title,
      // Only teaching prose/visuals, never interactive questions, hints, solutions, or outgoing links.
      contentBlocks: withoutDefinitionLinks(section.contentBlocks.filter(block => block.kind !== 'core.problem_set')),
    })).filter(section => section.contentBlocks.length);
    return { key, label: labels.get(key) ?? key,
      definition: definition ? leafGlossary(glossaryEntries([definition], teachers, courseKey))[0] : null,
      lesson: lesson && sections.length ? { lessonKey: lesson.lessonKey, title: record!.public.title, sections } : null };
  }));
  return { concepts };
}
