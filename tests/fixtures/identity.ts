import type { PrismaClient } from '@prisma/client';

/**
 * A lesson version hangs off a lesson, and a lesson off a course, so a fixture that writes a
 * version by hand has to put the identity in place first. Fixtures join the seeded fraction course
 * unless they say otherwise; the position only has to keep them behind the seeded lessons.
 */
export async function ensureLesson(db: PrismaClient, lessonKey: string, options: { courseKey?: string; order?: number } = {}) {
  const course = await db.course.upsert({ where: { key: options.courseKey ?? 'fractions' },
    update: {}, create: { key: options.courseKey ?? 'fractions', title: options.courseKey ?? '분수' } });
  return db.lesson.upsert({ where: { key: lessonKey }, update: {},
    create: { key: lessonKey, courseId: course.id, order: options.order ?? 1000 } });
}
