import type { PrismaClient } from '@prisma/client';

/**
 * Integration suites share one database and publish into it, and nothing published is ever removed
 * by the application — an immutable version is meant to stay. A run that leaves its lessons behind
 * therefore adds to the database forever, and once more than a thousand lesson versions have piled
 * up the content bundle refuses to load at all, which is how this first showed itself.
 *
 * So a suite takes note of what is already there and, when it is done, removes what it added: the
 * content it published and the learners it created, along with everything those learners did. It
 * never touches a row it did not put there, so the seeded content and another suite's rows are
 * safe, and a run against a database that already holds real work would leave that work alone.
 */
export type Existing = Awaited<ReturnType<typeof existingRows>>;

const ids = <T, K extends keyof T>(rows: T[], key: K) => new Set(rows.map(row => String(row[key])));

export async function existingRows(db: PrismaClient) {
  const [users, lessons, diagnostics, definitions, concepts, bundles, courses, lessonKeys, diagnosticKeys] = await Promise.all([
    db.user.findMany({ select: { id: true } }),
    db.lessonVersion.findMany({ select: { id: true } }),
    db.diagnosticVersion.findMany({ select: { id: true } }),
    db.conceptDefinition.findMany({ select: { id: true } }),
    db.concept.findMany({ select: { key: true } }),
    db.appliedContentBundle.findMany({ select: { name: true } }),
    db.course.findMany({ select: { key: true } }),
    db.lesson.findMany({ select: { key: true } }),
    db.diagnostic.findMany({ select: { key: true } }),
  ]);
  return { users: ids(users, 'id'), lessons: ids(lessons, 'id'), diagnostics: ids(diagnostics, 'id'),
    definitions: ids(definitions, 'id'), concepts: ids(concepts, 'key'), bundles: ids(bundles, 'name'),
    courses: ids(courses, 'key'), lessonKeys: ids(lessonKeys, 'key'), diagnosticKeys: ids(diagnosticKeys, 'key') };
}

/** What a suite adds is what it removes. Order follows the foreign keys, deepest first. */
export async function removeRowsAddedSince(db: PrismaClient, before: Existing) {
  const now = await existingRows(db);
  const added = (after: Set<string>, seen: Set<string>) => [...after].filter(id => !seen.has(id));
  const users = added(now.users, before.users);
  const lessons = added(now.lessons, before.lessons);
  const diagnostics = added(now.diagnostics, before.diagnostics);
  const definitions = added(now.definitions, before.definitions);
  const concepts = added(now.concepts, before.concepts);
  const bundles = added(now.bundles, before.bundles);
  const courses = added(now.courses, before.courses);
  const lessonKeys = added(now.lessonKeys, before.lessonKeys);
  const diagnosticKeys = added(now.diagnosticKeys, before.diagnosticKeys);
  const versions = [...lessons, ...diagnostics, ...definitions];
  if (!users.length && !versions.length && !concepts.length && !bundles.length && !courses.length && !lessonKeys.length && !diagnosticKeys.length) return;

  const collect = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map(row => row.id);
  const scopes = await collect(db.learningScope.findMany({ where: { ownerUserId: { in: users } }, select: { id: true } }));
  const enrollments = await collect(db.enrollment.findMany({ where: { OR: [{ userId: { in: users } }, { lessonVersionId: { in: lessons } }] }, select: { id: true } }));
  const assignments = await collect(db.assignment.findMany({ where: { OR: [{ ownerScopeId: { in: scopes } }, { sourceLessonVersionId: { in: lessons } }] }, select: { id: true } }));
  const recipients = await collect(db.assignmentRecipient.findMany({ where: { OR: [{ assignmentId: { in: assignments } }, { learnerUserId: { in: users } }, { sourceEnrollmentId: { in: enrollments } }] }, select: { id: true } }));
  const submissions = await collect(db.submission.findMany({ where: { recipientId: { in: recipients } }, select: { id: true } }));
  const items = await collect(db.assignmentItem.findMany({ where: { assignmentId: { in: assignments } }, select: { id: true } }));
  const attempts = await collect(db.attempt.findMany({ where: { OR: [{ userId: { in: users } }, { enrollmentId: { in: enrollments } }, { submissionId: { in: submissions } }, { assignmentItemId: { in: items } }] }, select: { id: true } }));

  await db.assessmentRevision.deleteMany({ where: { attemptId: { in: attempts } } });
  await db.submissionItem.deleteMany({ where: { OR: [{ submissionId: { in: submissions } }, { selectedAttemptId: { in: attempts } }, { assignmentItemId: { in: items } }] } });
  await db.attempt.deleteMany({ where: { id: { in: attempts } } });
  await db.submission.deleteMany({ where: { id: { in: submissions } } });
  await db.assignmentRecipient.deleteMany({ where: { id: { in: recipients } } });
  await db.assignmentItem.deleteMany({ where: { id: { in: items } } });
  await db.assignment.deleteMany({ where: { id: { in: assignments } } });
  await db.hintUse.deleteMany({ where: { userId: { in: users } } });
  await db.enrollment.deleteMany({ where: { id: { in: enrollments } } });
  await db.diagnosticRun.deleteMany({ where: { userId: { in: users } } });
  await db.recommendationHistory.deleteMany({ where: { userId: { in: users } } });
  await db.contentDraft.deleteMany({ where: { authorId: { in: users } } });
  await db.contentAuthor.deleteMany({ where: { userId: { in: users } } });
  await db.session.deleteMany({ where: { userId: { in: users } } });
  await db.googleIdentity.deleteMany({ where: { userId: { in: users } } });
  await db.learningScope.deleteMany({ where: { id: { in: scopes } } });
  await db.user.deleteMany({ where: { id: { in: users } } });

  // A published version is its rows, so the rows go with it.
  await db.contentBlock.deleteMany({ where: { ownerVersionId: { in: versions } } });
  await db.lessonSection.deleteMany({ where: { lessonVersionId: { in: lessons } } });
  await db.publishedProblem.deleteMany({ where: { ownerVersionId: { in: [...lessons, ...diagnostics] } } });
  await db.lessonVersion.deleteMany({ where: { id: { in: lessons } } });
  await db.diagnosticVersion.deleteMany({ where: { id: { in: diagnostics } } });
  // A definition owns blocks under its own id, the way a version does.
  await db.contentBlock.deleteMany({ where: { ownerKind: 'definition', ownerVersionId: { in: definitions } } });
  await db.conceptDefinition.deleteMany({ where: { id: { in: definitions } } });
  // Identities go after their versions, and a course after the identities it keeps. A draft of a
  // lesson this run made was already removed with its author.
  await db.contentDraft.deleteMany({ where: { lessonKey: { in: lessonKeys } } });
  await db.lesson.deleteMany({ where: { key: { in: lessonKeys } } });
  await db.diagnostic.deleteMany({ where: { key: { in: diagnosticKeys } } });
  await db.course.deleteMany({ where: { key: { in: courses } } });
  // A concept is named by the definitions and lessons that use it, so it goes last.
  await db.concept.deleteMany({ where: { key: { in: concepts } } });
  // The ledger would otherwise claim a bundle is applied whose content has just been removed.
  await db.appliedContentBundle.deleteMany({ where: { name: { in: bundles } } });
}
