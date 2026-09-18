import type { AssignmentView, GradeResult, PersonalPlan, PublicLesson, Recommendation, ConceptReadiness } from '@/shared/api';
import type { PlacementState } from './placement';
import { conceptGraph, placementScope } from './concept-graph';

export const personalizationVersion = 'rules-v1';
export type Evidence = { problemVersionId: string; conceptKeys: string[]; result: GradeResult; date: Date; responseKind?: string; check: boolean; assessmentId?: string };

/**
 * Where a learner stands on each concept: what their own work shows, and where the placement put
 * them until there is work to go on.
 *
 * The placement is read as it was recorded, not worked out again — the graph it descended is derived
 * from the catalogue, and a catalogue that grows afterwards must not move a learner who has since
 * stopped answering. A concept it carried rather than asked about says so, so a screen can too.
 */
export function conceptReadiness(labels: Record<string, string>, placement: PlacementState | null, evidence: Evidence[]): ConceptReadiness[] {
  return Object.entries(labels).map(([key, label]) => {
    const observed = evidence.filter(e => e.conceptKeys.includes(key) && e.result.status !== 'invalid');
    // First attempts only arrive here. A later check supersedes practice, while a later
    // unsuccessful review can reveal that an earlier success needs reinforcement.
    const assessments = observed.filter(e => e.check);
    const latest = [...(assessments.length ? assessments : observed)].sort((a, b) => b.date.getTime() - a.date.getTime())[0];
    const latestGroup = latest?.assessmentId ? observed.filter(e => e.assessmentId === latest.assessmentId && e.check === latest.check) : latest ? [latest] : [];
    if (latest) return { key, label, source: 'learning', readiness: latestGroup.every(e => e.result.status === 'correct' && !e.result.assisted) ? 'ready' : 'needs-practice' };
    const settled = placement?.placed[key];
    if (!settled || settled === 'unknown') return { key, label, source: 'none', readiness: 'unknown' };
    return { key, label, readiness: settled, source: placement!.source[key] === 'inferred' ? 'inferred' : 'diagnostic' };
  });
}

export function recommend(input: {
  lessons: PublicLesson[]; enrollments: { lessonKey: string; status: string }[];
  assignments: Pick<AssignmentView, 'recipientId' | 'recommendedAt' | 'status' | 'policy'>[];
  readiness: ConceptReadiness[]; dailyMinutes: number; targetCourseKey: string | null; now: Date; preferredLessonKey?: string | null;
}): { recommendations: Recommendation[]; plan: PersonalPlan } {
  const { lessons, enrollments, readiness, dailyMinutes, targetCourseKey } = input;
  const ready = (key: string) => readiness.some(s => s.key === key && s.readiness === 'ready');
  const known = (c: PublicLesson) => c.conceptKeys.every(ready);
  const prerequisitesMet = (c: PublicLesson) => c.prerequisiteConceptKeys.every(ready);
  const active = lessons.find(c => enrollments.some(e => e.lessonKey === c.lessonKey && e.status === 'active'));
  const weak = lessons.filter(c => !known(c));
  // Everything that leads to what the learner came for. Without a course named, that is everything —
  // and then the first lesson of the catalogue is what a beginner gets, whatever they came for.
  const wanted = lessons.filter(c => c.courseKey === targetCourseKey).flatMap(c => c.conceptKeys);
  const onTheWay = new Set(placementScope(conceptGraph(lessons), wanted));
  // The course they came for first, then what it stands on, then the rest. Somebody who came for
  // integers can start at negative numbers today, even though fractions also lie on the way.
  const nearness = (c: PublicLesson) => !wanted.length ? 0 : c.courseKey === targetCourseKey ? 0 : c.conceptKeys.some(key => onTheWay.has(key)) ? 1 : 2;
  // Sorting is stable, so each group keeps the catalogue's own order inside it.
  const remedial = weak.filter(prerequisitesMet).sort((a, b) => nearness(a) - nearness(b));
  // An unfinished chosen lesson remains available, but unknown prerequisites are recommended first.
  let target: PublicLesson | undefined = active && prerequisitesMet(active) ? active : remedial[0];
  if (!target && active) target = active;
  // Every available concept is provisionally ready: open the course they came for, or the catalogue.
  if (!target) target = lessons.find(c => c.courseKey === targetCourseKey) ?? lessons[0];
  const chosen = lessons.find(c => c.lessonKey === input.preferredLessonKey);
  if (chosen) target = chosen;
  const recommendations: Recommendation[] = [];
  if (target) {
    const enrollment = enrollments.find(e => e.lessonKey === target.lessonKey);
    const kind = enrollment?.status === 'completed' ? 'revisit' : enrollment ? 'continue' : 'start';
    const focus = readiness.find(s => target.conceptKeys.includes(s.key) && s.readiness !== 'ready');
    const reason = chosen ? `직접 고른 수업이에요.${prerequisitesMet(chosen) ? ' 나의 속도로 이어가 보세요.' : ' 아직 확인하지 않은 선수 개념이 있어요. 어려우면 자동 추천으로 돌아갈 수 있어요.'}`
      : active && active.lessonKey !== target.lessonKey
      ? `이어가던 수업에 필요한 ${focus?.label ?? target.title}부터 확인해요. 원래 수업도 직접 선택할 수 있어요.`
      : kind === 'continue' ? '진행 중인 수업을 이어가요. 새 풀이 기록으로 다음 추천을 조정해요.'
      : focus?.readiness === 'needs-practice' ? `${focus.label}에서 다시 연습할 부분을 찾았어요. 설명과 예제로 한 번 더 확인해요.`
      : focus && targetCourseKey && target.courseKey !== targetCourseKey
      ? `배우려는 과정이 딛고 선 ${focus.label}부터 확인해요. 여기를 지나면 그 과정으로 이어져요.`
      : focus ? `${focus.label} 개념을 아직 충분히 확인하지 않았어요. 이 수업부터 시작해 보세요.`
      : targetCourseKey ? '확인한 기초 위에서 배우려던 과정을 이어가요. 목록에서 다른 수업을 골라도 괜찮아요.'
      : '확인한 기초를 일상의 예제에 적용해요. 이미 아는 수업은 목록에서 자유롭게 바꿀 수 있어요.';
    recommendations.push({ lessonKey: target.lessonKey, kind, reason, suggestedMinutes: Math.min(dailyMinutes, target.estimatedMinutes) });
  }
  // Only work somebody issued to this learner is worth reminding them of. A problem set they opened
  // themselves is already where they left it, and calling it a due review would be nagging them
  // about their own choice.
  const due = [...input.assignments].filter(a => a.status === 'assigned' && a.policy.kind !== 'practice' && new Date(a.recommendedAt) <= input.now)
    .sort((a, b) => a.recommendedAt.localeCompare(b.recommendedAt))[0];
  return { recommendations, plan: { version: personalizationVersion, readiness, sessionMinutes: dailyMinutes, preferredLessonKey: chosen?.lessonKey ?? null,
    review: due ? { recipientId: due.recipientId, reason: '권장 복습 시점이 되었어요. 새 수업 전에 배운 내용을 다시 떠올려 보세요. 늦게 풀어도 괜찮아요.' } : null } };
}

// Snapshot this decision when issuing an assignment. Profile edits must never rewrite issued work.
export function reviewSelection<T extends { problemVersionId: string; conceptKeys: string[]; responseSpec: { kind: string } }>(
  candidates: T[], evidence: Evidence[], dailyMinutes: number,
) {
  const valid = evidence.filter(e => e.result.status !== 'invalid');
  const difficulty = valid.filter(e => e.result.status === 'incorrect' || e.result.assisted);
  const checks = valid.filter(e => e.check);
  const confident = checks.length > 0 && checks.every(e => e.result.status === 'correct' && !e.result.assisted) && difficulty.length === 0;
  const score = (p: T) => difficulty.reduce((sum, e) => sum + (p.conceptKeys.some(key => e.conceptKeys.includes(key)) ? 1 : 0) + (e.responseKind === p.responseSpec.kind ? 1 : 0), 0);
  const items = [...candidates].sort((a, b) => score(b) - score(a)).slice(0, dailyMinutes <= 5 ? 1 : 2);
  const intervalDays = confident ? 3 : 1;
  const reason = `${dailyMinutes}분 설정에 맞춰 ${items.length}문제를 골랐어요. ${confident ? '첫 풀이에서 도움 없이 해결해 3일 뒤 다시 확인해요.' : '연습이 더 필요하거나 확인한 풀이가 적어 다음 날 다시 확인해요.'}`;
  return { items, intervalDays, reason, version: personalizationVersion };
}
