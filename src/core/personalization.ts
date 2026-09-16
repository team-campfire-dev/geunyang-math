import type { AssignmentView, DiagnosticAnswer, Goal, GradeResult, PersonalPlan, PublicLesson, Recommendation, SkillReadiness } from '@/shared/api';

export const personalizationVersion = 'rules-v1';
export type Evidence = { problemVersionId: string; skillKeys: string[]; result: GradeResult; date: Date; responseKind?: string; check: boolean; assessmentId?: string };

export function skillReadiness(labels: Record<string, string>, diagnostic: { answers: DiagnosticAnswer[]; problems: { problemVersionId: string; skillKeys: string[] }[] } | null, evidence: Evidence[]): SkillReadiness[] {
  return Object.entries(labels).map(([key, label]) => {
    const observed = evidence.filter(e => e.skillKeys.includes(key) && e.result.status !== 'invalid');
    // First attempts only arrive here. A later check supersedes practice, while a later
    // unsuccessful review can reveal that an earlier success needs reinforcement.
    const assessments = observed.filter(e => e.check);
    const latest = [...(assessments.length ? assessments : observed)].sort((a, b) => b.date.getTime() - a.date.getTime())[0];
    const latestGroup = latest?.assessmentId ? observed.filter(e => e.assessmentId === latest.assessmentId && e.check === latest.check) : latest ? [latest] : [];
    if (latest) return { key, label, source: 'learning', readiness: latestGroup.every(e => e.result.status === 'correct' && !e.result.assisted) ? 'ready' : 'needs-practice' };
    const ids = diagnostic?.problems.filter(p => p.skillKeys.includes(key)).map(p => p.problemVersionId) ?? [];
    const answers = diagnostic?.answers.filter(a => ids.includes(a.problemVersionId)) ?? [];
    const readiness = answers.some(a => a.status === 'incorrect') ? 'needs-practice'
      : ids.length >= 2 && answers.length === ids.length && answers.every(a => a.status === 'correct') ? 'ready' : 'unknown';
    return { key, label, source: answers.some(a => a.status !== 'skipped') ? 'diagnostic' : 'none', readiness };
  });
}

export function recommend(input: {
  lessons: PublicLesson[]; enrollments: { lessonKey: string; status: string }[];
  assignments: Pick<AssignmentView, 'recipientId' | 'recommendedAt' | 'status'>[];
  readiness: SkillReadiness[]; dailyMinutes: number; goal: Goal; now: Date; preferredLessonKey?: string | null;
}): { recommendations: Recommendation[]; plan: PersonalPlan } {
  const { lessons, enrollments, readiness, dailyMinutes, goal } = input;
  const ready = (key: string) => readiness.some(s => s.key === key && s.readiness === 'ready');
  const known = (c: PublicLesson) => c.skillKeys.every(ready);
  const prerequisitesMet = (c: PublicLesson) => c.prerequisiteSkillKeys.every(ready);
  const active = lessons.find(c => enrollments.some(e => e.lessonKey === c.lessonKey && e.status === 'active'));
  const weak = lessons.filter(c => !known(c));
  const remedial = weak.filter(prerequisitesMet);
  // An unfinished chosen lesson remains available, but unknown prerequisites are recommended first.
  let target: PublicLesson | undefined = active && prerequisitesMet(active) ? active : remedial[0];
  if (!target && active) target = active;
  if (!target) {
    // All available skills are provisionally ready: choose a goal-relevant consolidation lesson.
    target = goal === 'algebra-ready' ? lessons.at(-1) : lessons[0];
  }
  const chosen = lessons.find(c => c.lessonKey === input.preferredLessonKey);
  if (chosen) target = chosen;
  const recommendations: Recommendation[] = [];
  if (target) {
    const enrollment = enrollments.find(e => e.lessonKey === target.lessonKey);
    const kind = enrollment?.status === 'completed' ? 'revisit' : enrollment ? 'continue' : 'start';
    const focus = readiness.find(s => target.skillKeys.includes(s.key) && s.readiness !== 'ready');
    const reason = chosen ? `직접 고른 수업이에요.${prerequisitesMet(chosen) ? ' 나의 속도로 이어가 보세요.' : ' 아직 확인하지 않은 선수 개념이 있어요. 어려우면 자동 추천으로 돌아갈 수 있어요.'}`
      : active && active.lessonKey !== target.lessonKey
      ? `이어가던 수업에 필요한 ${focus?.label ?? target.title}부터 확인해요. 원래 수업도 직접 선택할 수 있어요.`
      : kind === 'continue' ? '진행 중인 수업을 이어가요. 새 풀이 기록으로 다음 추천을 조정해요.'
      : focus?.readiness === 'needs-practice' ? `${focus.label}에서 다시 연습할 부분을 찾았어요. 설명과 예제로 한 번 더 확인해요.`
      : focus ? `${focus.label} 개념을 아직 충분히 확인하지 않았어요. 이 수업부터 시작해 보세요.`
      : goal === 'algebra-ready' ? '확인한 기초를 바탕으로 분수 계산을 다져 대수 학습을 준비해요.'
      : '확인한 기초를 일상의 예제에 적용해요. 이미 아는 수업은 목록에서 자유롭게 바꿀 수 있어요.';
    recommendations.push({ lessonKey: target.lessonKey, kind, reason, suggestedMinutes: Math.min(dailyMinutes, target.estimatedMinutes) });
  }
  const due = [...input.assignments].filter(a => a.status === 'assigned' && new Date(a.recommendedAt) <= input.now)
    .sort((a, b) => a.recommendedAt.localeCompare(b.recommendedAt))[0];
  return { recommendations, plan: { version: personalizationVersion, readiness, sessionMinutes: dailyMinutes, preferredLessonKey: chosen?.lessonKey ?? null,
    review: due ? { recipientId: due.recipientId, reason: '권장 복습 시점이 되었어요. 새 수업 전에 배운 내용을 다시 떠올려 보세요. 늦게 풀어도 괜찮아요.' } : null } };
}

// Snapshot this decision when issuing an assignment. Profile edits must never rewrite issued work.
export function reviewSelection<T extends { problemVersionId: string; skillKeys: string[]; responseSpec: { kind: string } }>(
  candidates: T[], evidence: Evidence[], dailyMinutes: number,
) {
  const valid = evidence.filter(e => e.result.status !== 'invalid');
  const difficulty = valid.filter(e => e.result.status === 'incorrect' || e.result.assisted);
  const checks = valid.filter(e => e.check);
  const confident = checks.length > 0 && checks.every(e => e.result.status === 'correct' && !e.result.assisted) && difficulty.length === 0;
  const score = (p: T) => difficulty.reduce((sum, e) => sum + (p.skillKeys.some(key => e.skillKeys.includes(key)) ? 1 : 0) + (e.responseKind === p.responseSpec.kind ? 1 : 0), 0);
  const items = [...candidates].sort((a, b) => score(b) - score(a)).slice(0, dailyMinutes <= 5 ? 1 : 2);
  const intervalDays = confident ? 3 : 1;
  const reason = `${dailyMinutes}분 설정에 맞춰 ${items.length}문제를 골랐어요. ${confident ? '첫 풀이에서 도움 없이 해결해 3일 뒤 다시 확인해요.' : '연습이 더 필요하거나 확인한 풀이가 적어 다음 날 다시 확인해요.'}`;
  return { items, intervalDays, reason, version: personalizationVersion };
}
